# Upload replay melalui API

Panduan ini mengunggah replay Dota 2 dari terminal tanpa membuka dashboard.
Setiap replay diproses berurutan: script meminta tiket, mengunggah langsung ke
S3, lalu menunggu parsing selesai sebelum melanjutkan ke file berikutnya.

## Prasyarat

- `bash`, `curl`, `jq`, dan `stat` tersedia di komputer.
- File replay bernama `<match_id>.dem`, misalnya `1234567890.dem`.
- Anda memiliki password upload yang aktif. Jangan simpan password di script
  atau commit ke Git.

Endpoint upload saat ini:

```text
https://w1tedlcinh.execute-api.us-east-1.amazonaws.com
```

## Simpan password untuk satu sesi terminal

Gunakan input tersembunyi agar password tidak masuk ke riwayat shell:

```bash
read -rsp "Upload password: " UPLOAD_TOKEN
export UPLOAD_TOKEN
echo
```

Tes password sebelum mengunggah:

```bash
curl --fail-with-body -sS \
  -H "x-upload-token: $UPLOAD_TOKEN" \
  https://w1tedlcinh.execute-api.us-east-1.amazonaws.com/token-check
```

Respons yang benar:

```json
{"ok":true}
```

## Script batch

Simpan script berikut sebagai `upload-many.sh` lalu jalankan
`chmod +x upload-many.sh`.

```bash
#!/usr/bin/env bash
set -euo pipefail

API_URL="https://w1tedlcinh.execute-api.us-east-1.amazonaws.com"
: "${UPLOAD_TOKEN:?Set UPLOAD_TOKEN terlebih dahulu.}"

upload_one() {
  local file="$1"
  local filename ticket response_body http_status match_id status
  local -a form_args=()

  filename="$(basename "$file")"
  if [[ ! "$filename" =~ ^[0-9]+\.dem$ ]]; then
    echo "SKIP: $filename — nama harus <match_id>.dem" >&2
    return 0
  fi

  response_body="$(mktemp)"
  http_status="$(
    curl -sS -o "$response_body" -w '%{http_code}' \
      -X POST "$API_URL/replays" \
      -H "content-type: application/json" \
      -H "x-upload-token: $UPLOAD_TOKEN" \
      --data "$(jq -n \
        --arg filename "$filename" \
        --argjson size "$(stat -c%s "$file")" \
        '{filename: $filename, size: $size}')"
  )"
  ticket="$(cat "$response_body")"
  rm -f "$response_body"

  case "$http_status" in
    201) ;;
    409)
      echo "SKIP: $filename — replay sudah ada"
      return 0
      ;;
    401)
      echo "ERROR: password upload salah atau sudah tidak berlaku" >&2
      return 1
      ;;
    *)
      echo "ERROR: tidak bisa membuat tiket untuk $filename (HTTP $http_status)" >&2
      echo "$ticket" | jq . >&2 || true
      return 1
      ;;
  esac

  match_id="$(echo "$ticket" | jq -r '.match_id')"
  while IFS=$'\t' read -r key value; do
    form_args+=(-F "$key=$value")
  done < <(echo "$ticket" | jq -r '.upload.fields | to_entries[] | [.key, .value] | @tsv')

  echo "UPLOAD: $filename"
  curl --fail-with-body -sS \
    "${form_args[@]}" \
    -F "file=@$file" \
    "$(echo "$ticket" | jq -r '.upload.url')"

  echo "PARSING: $match_id"
  while true; do
    status="$(curl --fail-with-body -sS \
      -H "x-upload-token: $UPLOAD_TOKEN" \
      "$API_URL/replays/$match_id")"

    case "$(echo "$status" | jq -r '.status')" in
      parsed)
        echo "DONE: $filename"
        return 0
        ;;
      failed)
        echo "FAILED: $filename" >&2
        echo "$status" | jq . >&2
        return 1
        ;;
      *) sleep 5 ;;
    esac
  done
}

for file in "$@"; do
  upload_one "$file"
done
```

## Menjalankan upload

Pilih beberapa replay secara eksplisit:

```bash
./upload-many.sh \
  ~/dota-replays/1234567890.dem \
  ~/dota-replays/1234567891.dem \
  ~/dota-replays/1234567892.dem
```

Atau semua replay dalam folder:

```bash
./upload-many.sh ~/dota-replays/*.dem
```

## Respons API penting

| Endpoint | Fungsi |
| --- | --- |
| `GET /token-check` | Memeriksa password upload. |
| `POST /replays` | Memvalidasi nama file/password dan menerbitkan presigned S3 POST. |
| `GET /replays/<match_id>` | Mengembalikan status `uploaded`, `processing`, `parsed`, atau `failed`. |

`POST /replays` mengembalikan HTTP `409` bila replay sudah tersedia. Script
batch memperlakukan kondisi itu sebagai `SKIP`, sehingga file lain tetap
diproses.
