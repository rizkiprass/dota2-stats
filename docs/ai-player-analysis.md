# AI Player Profile Analysis (on-demand)

Analisis AI per pemain untuk halaman profil pemain. Satu Lambda terpisah,
`dota-replay-ai-profile`, membaca agregat yang sudah dipublikasikan
(`stats/stats.json`, `stats/matches.json`) plus replay yang sudah diparse untuk
jendela 20 match terakhir pemain tersebut, menghitung seluruh metrik secara
deterministik di Python, lalu meminta model **menafsirkan** bukti itu — bukan
menghitung apa pun sendiri. Hasil disimpan di bucket privat dan tidak pernah
dibangkitkan ulang pada setiap page view.

Dokumen ini sekaligus runbook: reparse, backfill, rollback, dan pemantauan biaya
ada di bagian akhir.

## Model biaya dan kontrak cache

Satu-satunya hal yang boleh menghabiskan token provider adalah `POST`. Kontraknya:

- `GET /players/{account_id}/profile` membaca **satu objek S3**
  (`ai-cache/profile/<account_id>.json`) dan mengembalikan isinya. Tidak ada
  perhitungan metrik, tidak ada pembacaan replay, tidak ada panggilan model, dan
  tidak ada trace Langfuse. Page view karena itu praktis gratis.
- `POST` menghitung ulang metrik, membandingkan `source_hash` dengan yang tersimpan,
  dan **hanya** memanggil model bila hash berubah (atau `{"force": true}`). Cache hit
  mengembalikan jawaban tersimpan dengan `cached: true`.
- Pemain yang tidak memenuhi syarat dijawab `200` dengan `status: "insufficient_data"`
  **sebelum** kode menyentuh model, jadi pemain yang tidak bisa dikarakterisasi
  tidak biaya apa pun.
- Kegagalan menulis cache tidak membuang jawaban yang sudah dibayar: respons tetap
  `200` dengan `stored: false`, dan permintaan berikutnya membangkitkan ulang.

Angka terukur pada dataset production (57 replay, 26 pemain): konteks yang dikirim ke
model 1239–1507 token (rata-rata ≈1357, pagar 3500), termasuk daftar kunci yang boleh
dikutip (≈300 token) — daftar itulah yang membuat cek sitasi bisa ditegakkan oleh
model sendiri alih-alih hanya oleh validator. Satu analisis ≈ **$0.0059** (≈ $0.012
bila retry terpakai). 18 pemain memenuhi syarat, 8 tidak. Backfill 18 pemain ≈
$0.11–0.22 sekali jalan. Kontrol biaya yang sebenarnya adalah limit bulanan kunci
OpenRouter (**$1/bulan**); tabel rate DynamoDB (`dota-replay-ai-rate`, dipakai bersama
dengan match analysis) hanya pembatas abuse 10 panggilan uncached per IP per jam — dan
sengaja dipakai bersama supaya satu klien tidak bisa mengelak lewat permukaan AI
satunya saat budget hampir habis.

## Bukti: apa yang boleh dan tidak boleh dikatakan model

`ai/profile_metrics.py` menghitung semuanya; `ai/profile_handler.py` memvalidasi
jawaban terhadap payload itu sendiri, per pemain. Aturan yang ditegakkan sebelum
jawaban diterima:

- **Angka**: setiap figure dalam prosa harus cocok (toleransi 1% atau setengah
  satuan, plus konversi persen satu arah) dengan angka yang benar-benar ada di
  payload. Skala persen dibatasi supaya `42.42` di payload tidak melisensi `4242`
  di prosa.
- **Kutipan**: setiap finding wajib menyebut kunci metrik yang ada
  (`evidence_keys`); kunci yang tidak dipublikasikan jendela itu ditolak.
- **Klaim populasi**: peringkat lobby boleh dikutip karena memang dipublikasikan;
  "top 5% semua pemain", persentil global, MMR, atau bracket tidak.
- **Kemampuan yang tidak direkam**: ward placement / map awareness / positioning /
  rotasi, perilaku chat & ping, sebab-akibat, dan spesifikasi objektif (tower mana,
  menit ke berapa) selalu ditolak. Jumlah `towers_killed` per pemain boleh dikutip
  karena itu counter scoreboard sungguhan.
- **Trend**: hanya dipublikasikan bila jendela ≥ 6 match dengan ≥ 3 match per sisi.
  Bila tidak, field `trend` **dihilangkan dari prompt** dan ditulis server-side
  sebagai `direction: "unknown"`, sehingga model tidak bisa mengarang arah.
- **Peran**: label peran adalah heuristik parser; di bawah confidence 0.6 profil
  tetap role-neutral dan klaim kepastian peran ditandai.
- **Catatan limitations** hanya diperiksa angkanya, bukan wording-nya: tujuan field
  itu justru menyebut apa yang tidak direkam (ward placement, chat, laning, MMR).
  Headline dan setiap finding diperiksa penuh.

Jawaban yang melanggar dicoba ulang satu kali dengan nama aturan yang dilanggar;
bila tetap melanggar, jawaban dengan pelanggaran paling sedikit yang dipakai, dan
nama aturannya (bukan prosanya) masuk log serta trace.

## Privasi

- Identitas memakai `account_id` saja. Display name tidak pernah masuk konteks model
  (di production ada `player_name` seperti `"4"`, `";"`, `"666"` — identitas harus
  dari account id).
- Data perilaku (`chat_messages`, `pings`, `disconnects`, `disruptive_score`) tidak
  masuk konteks AI sama sekali; ia tetap hanya tampil di kartu `PlayerActivity`.
- Seri menit per pemain (`player_snapshots`) adalah input metrik, bukan bukti untuk
  model, dan tidak dikirim.
- Hasil disimpan **privat** di `ai-cache/profile/` pada bucket replay dan disajikan
  lewat API ini. Tidak ada mirror ke bucket dashboard dan tidak ada behavior
  CloudFront baru: statistik agregat lobby memang publik, tetapi penilaian
  interpretif atas satu orang bernama bukan.
- Langfuse: trace hanya untuk `POST`, berisi account id, versi prompt, status HTTP,
  flag cache/regenerate/sample tier, dan daftar nama aturan yang dilanggar. Prose
  profil dan payload metrik **tidak** dikirim kecuali
  `langfuse_capture_profile_output = true` (default `false`) — berbeda dari match
  insight yang default-nya on, karena profil adalah penilaian menetap tentang satu
  orang, bukan pembacaan satu match.

## Gate sampel

| Konstanta | Nilai | Efek |
| --- | --- | --- |
| `WINDOW_MATCHES` | 20 | hanya match terbaru yang dibaca |
| `MIN_ELIGIBLE_MATCHES` | 5 | di bawahnya: `insufficient_data`, tanpa model |
| `STRONG_SAMPLE_MATCHES` | 10 | di bawahnya tier `small` → peringatan sampel kecil + confidence `low` |
| `MIN_TREND_MATCHES` | 6 | di bawahnya trend tidak dipublikasikan |
| `ROLE_CONFIDENCE_THRESHOLD` | 0.6 | di bawahnya profil role-neutral |

`confidence` pada respons dihitung dari tier sampel di kode, tidak pernah diminta
dari model.

## Ketergantungan schema 8 dan urutan deploy

Fase 1 menambah `timeline.player_snapshots` (schema 8) di parser. Dua hal harus
jalan berurutan:

1. **Image parser** harus di-push ke ECR lebih dulu — `normalize.py` terbake ke
   dalam image, jadi schema 8 tidak aktif tanpa build+push.
2. **`terraform apply`** membawa `api/handler.py` dengan `CURRENT_SCHEMA_VERSION = 8`
   (resource `aws_lambda_function.upload_api` ikut berubah di plan). Selama parsed
   masih schema 7, pengecekan duplikat upload akan menganggap semua match lama
   "boleh di-upload ulang" — itu memang jalur reprocess yang didokumentasikan,
   tetapi jendela itu harus ditutup dengan reparse segera setelah apply.

Karena itu: build+push image → apply → reparse 57 replay, dalam satu langkah yang
disetujui, dan dijadwalkan **tepat setelah reset limit bulanan OpenRouter** karena
schema bump membuat 48 objek `ai-cache/` lama stranded (regenerasi ≈ $0.22–0.32).
Jangan batch pre-warm; pantau Langfuse setelahnya.

## Deployment

Variabel Terraform (`terraform/ai-profile.tf`):

- `ai_profile_enabled` (default `true`, hanya berlaku bila `ai_enabled` juga true).
- `langfuse_capture_profile_output` (default `false`).

Yang dibuat: satu Lambda (`dota-replay-ai-profile`, 256 MB, timeout 45s bila
Langfuse aktif), role sendiri (bukan role match analysis — role itu punya
`ai-cache/*` tulis yang tidak boleh dimiliki fungsi ini), log group 30 hari, tiga
route eksplisit (`GET`/`POST`/`OPTIONS /players/{account_id}/profile`) pada API HTTP
yang sudah ada (route spesifik mendahului `$default`, jadi fungsi live tidak
tersentuh), dan permission invoke. IAM hanya `s3:GetObject` pada `parsed/*`,
`stats/*`, `ai-cache/profile/*`; `s3:PutObject` hanya pada `ai-cache/profile/*`;
tidak ada `s3:ListBucket` karena jendela dipilih dari index `matches.json`.

Kill switch runtime: env `AI_PROFILE_ENABLED=false` → `503` untuk GET dan POST tanpa
menyentuh model atau S3.

Frontend dibangun dengan `VITE_AI_API_URL` seperti biasa; kartu "Player read" tampil
di halaman profil hanya bila variabel itu ada saat build.

## Runbook

**Reparse setelah schema bump** (jangan pernah menyentuh `raw/` atau menghapus
`parsed/`), per match:

```sh
aws lambda invoke --function-name dota-replay-parser \
  --invocation-type RequestResponse --cli-binary-format raw-in-base64-out \
  --payload '{"Records":[{"s3":{"bucket":{"name":"dta-replay-data-rizkiprass-2026"},"object":{"key":"raw/<match_id>.dem"}}}]}' \
  /tmp/parser-response.json --profile pras-sandbox
```

Biaya ≈ $0.034 untuk 57 replay. Setelah selesai, verifikasi
`schema_version: 8` dan keberadaan `player_snapshots` pada beberapa objek, lalu
konfirmasi `ai-cache/` lama teregenerasi bertahap lewat permintaan POST (bukan
batch).

**Backfill profil** untuk 18 pemain yang memenuhi syarat: satu `POST` per pemain
lewat API (atau invoke Lambda langsung). Lakukan di bulan yang berbeda dari reparse
bila budget bulan berjalan sudah terpakai; gabungan keduanya ≈ $0.86–1.07 dan
menyentuh limit $1.

**Rollback**: set `ai_profile_enabled = false` dan apply (route + Lambda hilang,
objek cache tetap tidak berbahaya), atau lebih cepat lagi set env
`AI_PROFILE_ENABLED=false` pada fungsi untuk mematikan tanpa deploy. Frontend
kembali ke kondisi tanpa kartu bila dibangun ulang tanpa `VITE_AI_API_URL`.

**Pemantauan biaya**: Langfuse trace `player-profile` (hanya POST) memuat flag
`cached`/`regenerated` dan `evaluation_target` (= generasi baru); CloudWatch log
group `/aws/lambda/dota-replay-ai-profile` mencatat `Profile cache hit` per
account. Rasio cache hit yang sehat ≈ mayoritas POST. Bila generasi baru muncul
terus-menerus untuk pemain yang sama, curigai perubahan `source_hash` (misalnya
reparse yang mengubah angka) dan bandingkan `meta.source_hash` antar waktu.

## Pengembangan lokal dan test

Backend: `python3 -m unittest ai.test_profile_metrics ai.test_profile_handler`
(mock penuh, tidak memanggil OpenRouter).

Set evaluasi berjalan dua babak, dan babak pertama tidak menyentuh provider sama
sekali: ia hanya mengukur input untuk seluruh pemain dari salinan bucket privat.

```sh
python3 ai/eval_profile.py /path/ke/fixtures            # eligibility, tier, ukuran konteks, jumlah kunci
python3 ai/eval_profile.py /path/ke/fixtures --answers /path/ke/answers
```

`answers/<account_id>.json` berisi teks model mentah (atau `{"response": ...}`) yang
direkam dari trace Langfuse saat backfill, atau dari satu generasi berbayar per
pemain; harness memainkannya ulang lewat validator yang sama dengan Lambda dan
melaporkan schema pass rate, histogram flag klaim tak berdasar, dan ukuran konteks.
Kedua direktori itu data privat dan penilaian atas orang bernama, jadi tidak boleh
masuk version control — sama seperti fixture `local_server.py`.

Frontend: build dengan `VITE_AI_API_URL` lalu
`PW_CHANNEL=chrome VITE_AI_API_URL=... npx playwright test tests/player-insight.spec.ts`.
Suite itu mengassert hal yang penting bagi biaya: page view tidak pernah POST,
analisis tersimpan tampil tanpa generasi, sampel yang tidak memenuhi syarat tidak
menawarkan tombol, dan staleness ditandai dari waktu match terbaru.
