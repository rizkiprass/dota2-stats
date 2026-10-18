# Dota 2 Private Lobby Statistics – MVP

Low-cost Dota 2 private-lobby replay parsing and historical statistics pipeline on AWS.

> Upload a `.dem` replay to S3 → parser Lambda produces normalized match JSON → aggregator Lambda rebuilds one dashboard-ready `stats/stats.json`.

See [`dota_replay_mvp_plan.md`](./dota_replay_mvp_plan.md) and [`dota_replay_mvp2_plan.md`](./dota_replay_mvp2_plan.md) for the design rationale, and [`docs/architecture.md`](./docs/architecture.md) for a condensed architecture summary.

## Repository Structure

```text
dota-lobby-stats2/
|
+-- parser/               Lambda container image (Python orchestrator + odota/parser Java jar)
|   +-- Dockerfile
|   +-- handler.py         Lambda entrypoint: download -> parse -> normalize -> upload
|   +-- normalize.py       Converts parser events into the versioned telemetry schema
|   +-- requirements.txt
|
+-- api/                  ZIP Lambda behind an API Gateway HTTP API
|   +-- handler.py         Issues presigned uploads (raw/<match_id>.dem), rejects duplicates
|
+-- aggregator/            ZIP Lambda for deterministic historical statistics rebuilds
|   +-- aggregator.py      Lists parsed JSON, validates/deduplicates, rebuilds stats/stats.json (+ stats/matches.json)
|   +-- requirements.txt
|
+-- terraform/            Infrastructure as code (S3, ECR, Lambda, IAM, dashboard)
|   +-- main.tf
|   +-- variables.tf
|   +-- outputs.tf
|   +-- s3.tf
|   +-- ecr.tf
|   +-- lambda.tf
|   +-- iam.tf
|   +-- api.tf            Upload API (API Gateway HTTP API + presigned-upload Lambda)
|   +-- dashboard.tf      Static website bucket for the dashboard
|
+-- web/                  React + TypeScript dashboard (Vite + Tailwind v4)
|   +-- package.json      Build scripts (npm run build -> web/dist/)
|   +-- vite.config.ts
|   +-- index.html
|   +-- src/
|       +-- components/    Header, Dashboard, Summary, Leaderboards, Tables, Heroes, ActivityRadar, PlayerProfile, ui
|       +-- lib/           api (stats.json), derived metrics, heroes (CDN art), theme, format
|       +-- router.tsx     TanStack Router routes (/ and /player/$playerId)
|       +-- types/         stats.ts (schema mirror)
|       +-- styles.css     Tailwind entry + design tokens
|
+-- scripts/
|   +-- upload-replays.sh Batch-upload .dem replays to s3://<bucket>/raw/
|   +-- orca-shot.sh      Capture dashboard screenshots through the Orca browser for visual review
|
+-- samples/
|   +-- parsed-example.json
|
+-- docs/
|   +-- architecture.md
|
+-- dota_replay_mvp_plan.md
+-- README.md
```

## How it works

The pipeline has two S3-triggered stages. `raw/*.dem` is immutable source data;
`parsed/*.json`, `stats.json`, and `matches.json` are derived data.

```text
Browser / CLI
    -> S3 raw/<match_id>.dem
    -> S3 ObjectCreated notification
    -> Parser Lambda
    -> S3 parsed/<match_id>.json
    -> S3 ObjectCreated notification
    -> Aggregator Lambda (full historical rebuild)
    -> stats/stats.json and stats/matches.json
    -> dashboard bucket mirror
    -> CloudFront
    -> React dashboard
```

### Upload and parse

1. Web upload calls `POST /replays`; the Upload API validates the shared token,
   filename, size, and duplicate state, then returns a short-lived presigned
   S3 POST. CLI upload writes to the same `raw/` prefix directly.
2. The browser uploads replay bytes directly to
   `s3://<bucket>/raw/<match_id>.dem`; API Gateway and the Upload API never
   receive the replay body.
3. S3 `ObjectCreated:*` filtered to `raw/*.dem` invokes the Parser Lambda.
4. The parser checks `parsed/<match_id>.json`. It skips only when the parsed
   `schema_version` is current; an older schema is eligible for reprocessing.
5. The parser downloads the `.dem` to `/tmp`, runs the bundled
   [`odota/parser`](https://github.com/odota/parser) Java parser through
   [Clarity](https://github.com/skadistats/clarity), and normalizes the event
   stream in `parser/normalize.py`.
6. Normalized output includes match metadata, players, K/D/A, behavior counts,
   economy, last hits, damage, wards, stuns, early positions, lane heuristic,
   and role heuristic.
7. The parser writes `parsed/<match_id>.json`. Failed parses retain the raw
   replay and write a diagnostic marker to `parse-failed/<match_id>.json`.

### Aggregate and publish

1. S3 `ObjectCreated:*` filtered to `parsed/*.json` invokes the Aggregator
   Lambda.
2. The aggregator lists every parsed JSON and performs a full rebuild. It
   validates matches, removes duplicate match IDs, and counts only allowed
   lobby types (`1` by default, Practice/private lobby).
3. It calculates player, hero, player-hero, teammate, head-to-head, behavior,
   leaderboard, recent-match, and role-specific statistics.
4. Role rankings use replay telemetry: Support uses vision, kill participation,
   assists, and stuns; Offlane uses kill participation, hero/tower damage, and
   stuns; Carry uses GPM, hero/tower damage, and last hits.
5. The aggregator writes the source payloads to:

   ```text
   s3://<bucket>/stats/stats.json
   s3://<bucket>/stats/matches.json
   ```

6. It mirrors both JSON payloads to the private dashboard bucket. CloudFront
   serves the static assets and same-origin `stats.json`/`matches.json` to the
   React application.
7. The frontend reads `stats.json` for the dashboard summary and loads the
   bounded `matches.json` payload for match-history and detail views.

The original `.dem` file remains in `raw/` as the source of truth at every
stage.

## In-dashboard replay upload

Players upload a replay from the dashboard itself — the **Upload replay** button in the header — instead of running the script below.

1. The player types the shared upload password once; the browser stores it and sends it as the `X-Upload-Token` header on every request.
2. `POST /replays` validates the password, rejects a current duplicate with
   `409`, and allows upload when the existing parsed payload has an older
   schema. Otherwise it returns a short-lived presigned S3 POST.
3. The browser uploads the `.dem` straight to `raw/<match_id>.dem`; the replay bytes never pass through API Gateway or Lambda, so replay size is not capped by the 10 MB payload limit.
4. The parser skips only when `parsed/<match_id>.json` has the current schema.
   This protects against duplicate events while still allowing stale derived
   data to be regenerated. A failed parse is recorded under
   `parse-failed/<match_id>.json` and shown in the dialog.
5. `GET /replays/<match_id>` reports `processing` / `parsed` / `failed`, which the dialog polls until the dashboard can refresh.

Current duplicates are blocked at the API and parser. Replays with an older
parsed schema are intentionally allowed through so the normal pipeline can
refresh derived data after a parser upgrade.

`upload_token` in `terraform.tfvars` is that shared password — set it before `terraform apply`, and rotate it by changing the value. The dashboard itself stays public; the password only gates uploading, not viewing. It lives in the player's browser, never in the build output, so it cannot be lifted from the deployed JavaScript.

## Parser choice

The odota/parser project normally runs as an HTTP server on port 5600 (`java -jar target/stats-0.1.0.jar`), receiving the replay as a POST body and returning line-delimited JSON events. For this MVP we instead run `Parse` directly against a file via a small CLI wrapper (`FileParse.java`) baked into the image, which avoids running an HTTP server inside the Lambda container and lets the Python handler simply shell out and capture stdout. See `parser/Dockerfile` and `parser/java/` for details.

## Build & deploy

### 1. Build and push the Lambda container image

```bash
cd parser
docker build -t dota-replay-parser .

aws ecr get-login-password --region <region> \
  | docker login --username AWS --password-stdin <account_id>.dkr.ecr.<region>.amazonaws.com

docker tag dota-replay-parser:latest <account_id>.dkr.ecr.<region>.amazonaws.com/dota-replay-parser:latest
docker push <account_id>.dkr.ecr.<region>.amazonaws.com/dota-replay-parser:latest
```

### 2. Provision infrastructure with Terraform

```bash
cd terraform
terraform init
terraform plan -var="aws_region=<region>" -var="account_id=<account_id>"
terraform apply -var="aws_region=<region>" -var="account_id=<account_id>"
```

Terraform creates:

- S3 bucket with `raw/` and `parsed/` prefixes
- ECR repository for the parser image
- IAM role/policy scoping Lambda to S3 read/write + CloudWatch logs + ECR pull
- Lambda function (container image) with the S3 `ObjectCreated` trigger scoped to `raw/*.dem`
- Upload API (API Gateway HTTP API + `dota-replay-upload-api` Lambda) with its own least-privilege role, letting the dashboard request presigned uploads and check for duplicates

> Set `upload_token` (the shared upload password) in `terraform.tfvars` before `terraform apply`; it is required. `scripts/deploy-web.sh` reads `terraform output upload_api_url` and bakes it into the build, so run the Terraform apply first.

> Note: Terraform provisions the Lambda function pointing at the ECR image tag. Push the image (step 1) **before** running `terraform apply`, otherwise Lambda creation will fail because the image doesn't exist yet.

### Updating an existing deployment without Terraform state

Terraform is only needed when provisioning or reconciling infrastructure. If
the Terraform state is unavailable, update existing resources directly with
the AWS CLI:

1. Build and push the parser image to ECR, then run
   `aws lambda update-function-code --image-uri ...` for the parser Lambda.
2. Zip `aggregator/aggregator.py` and `api/handler.py` and deploy them with
   `aws lambda update-function-code --zip-file ...`.
3. Apply any new IAM statements with `aws iam put-role-policy`, preserving the
   existing inline policy statements.
4. Deploy the dashboard with explicit `--bucket`, `--distribution-id`,
   `--upload-api-url`, `--profile`, and `--region` values:

   ```bash
   scripts/deploy-web.sh \
     --bucket <dashboard_bucket> \
     --distribution-id <cloudfront_distribution_id> \
     --upload-api-url <upload_api_url> \
     --profile <profile> \
     --region <region> \
     --wait
   ```

Do not run `terraform apply` against a new or empty state unless the existing
AWS resources have first been imported and the configuration has been audited.

### 3. Test

```bash
aws s3 cp samples/some-replay.dem s3://<bucket>/raw/<match_id>.dem
aws s3 cp s3://<bucket>/parsed/<match_id>.json - | jq .
```

Check CloudWatch Logs (`/aws/lambda/dota-replay-parser`) for parse duration, replay size, and any errors.

## Dashboard

A React + TypeScript single-page app (Vite + Tailwind v4, TanStack Router) reads
`stats.json` and renders the summary, leaderboards, player/hero/teammate/head-to-head
views, and a shareable player profile page at `/player/<id>`.

> Working on the dashboard with AI assistance? Run `npm run test:ui` (Playwright) for assertion coverage, capture screenshots of the running SPA with the Orca browser, and hand them to the `visual-reviewer` agent for critique. The `design-system` skill documents the tokens. See [`docs/architecture.md`](./docs/architecture.md) for the pipeline.

- Terraform (`dashboard.tf`) creates a **private** S3 bucket fronted by **CloudFront** with Origin Access Control + a security-headers policy. HTTPS, caching, and the SPA fallback are handled at the edge.
- The aggregator mirrors both payloads into the dashboard bucket — `stats.json` and `matches.json` — so the page always shows the latest rebuild with no cross-bucket CORS. CloudFront serves both paths with caching disabled, so neither is ever stale. The dashboard fetches `stats.json` on every load; leaderboard detail pages fetch `matches.json` lazily.
- Build and deploy the frontend with `scripts/deploy-web.sh` (bucket and
  distribution ID are read from `terraform output`; `stats.json` is never
  touched):

  ```bash
  scripts/deploy-web.sh --dry-run    # show the plan, change nothing
  scripts/deploy-web.sh              # build + deploy + invalidate
  scripts/deploy-web.sh --skip-build # deploy the existing web/dist/
  scripts/deploy-web.sh --wait       # wait for the invalidation to finish
  ```

  `--bucket`, `--distribution-id`, `--profile`, and `--region` override the
  defaults; the same values can be set through the `DASHBOARD_BUCKET`,
  `CLOUDFRONT_DISTRIBUTION_ID`, `AWS_PROFILE_NAME`, and `AWS_REGION_NAME`
  environment variables.

  Under the hood it runs the equivalent of:

  ```bash
  cd web && npm run build
  aws s3 sync web/dist/ s3://<dashboard_bucket>/ \
    --exclude "stats.json" --exclude "matches.json" --exclude "index.html" --delete \
    --cache-control "public, max-age=31536000, immutable" \
    --profile <profile> --region <region>
  aws s3 cp web/dist/index.html s3://<dashboard_bucket>/index.html \
    --cache-control "no-cache" --profile <profile> --region <region>
  aws cloudfront create-invalidation --distribution-id <dist_id> \
    --paths "/index.html" "/" "/assets/*" --profile <profile> --region <region>
  ```

- Terraform outputs `dashboard_url` (HTTPS CloudFront URL), `dashboard_cloudfront_domain` (CNAME target), and `dashboard_cloudfront_distribution_id`. `GET /stats.json` and `GET /matches.json` are served same-origin.

### Frontend CI/CD

GitHub Actions validates frontend changes before they reach production. The
workflows live in `.github/workflows/` and only cover the React dashboard and
its static deployment; Terraform and the replay parser remain manually
operated.

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `Frontend CI` | Pull request or push to `main` that changes frontend files | Installs dependencies, installs Playwright Chromium, builds the app, and runs the Playwright UI suite. |
| `Deploy frontend` | Manual `workflow_dispatch` from `main` | Re-runs build and UI tests, deploys `web/dist/` to S3, invalidates CloudFront, and smoke-tests the production dashboard. |

The normal frontend workflow is:

```text
Change frontend -> review on localhost -> push / open PR -> Frontend CI passes
-> manually run Deploy frontend from main -> production smoke test passes
```

Before pushing, review the UI locally and run the same core checks:

```bash
cd web
npm run dev       # manual desktop/mobile visual review on localhost
npm run build     # TypeScript check and production bundle
npm run test:ui   # Playwright browser tests
```

`npm run build` confirms the dashboard can be compiled into `web/dist/`.
`npm run test:ui` opens the built application in Playwright and checks routes,
data loading, responsive layout, and browser errors. The CI runner installs its
own Chromium binary with `npx playwright install --with-deps chromium` before
running the suite.

Production deployment is deliberately manual. The repository does not expose a
GitHub Environment required-reviewer rule, so starting `Deploy frontend` from
the Actions tab is the production approval gate. Select `main` before clicking
**Run workflow**.

The deploy workflow uses GitHub Actions OIDC, not a long-lived AWS access key.
AWS grants temporary credentials to
`dota-replay-dashboard-github-deploy` only for the `production` environment in
`rizkiprass/dota2-stats`. The role can update static dashboard assets and create
CloudFront invalidations, but has an explicit deny on `stats.json` and
`matches.json`; those files remain owned by the aggregator Lambda.

The `production` GitHub Environment contains these non-secret variables:

| Variable | Purpose |
| --- | --- |
| `AWS_REGION` | Region for the dashboard resources. |
| `AWS_DEPLOY_ROLE_ARN` | OIDC role assumed by the deploy job. |
| `DASHBOARD_BUCKET` | Static dashboard S3 bucket. |
| `CLOUDFRONT_DISTRIBUTION_ID` | Distribution invalidated after deployment. |
| `VITE_UPLOAD_API_URL` | Upload API base URL baked into the frontend build. |

See [`docs/frontend-cicd.md`](./docs/frontend-cicd.md) for the OIDC trust
policy, least-privilege IAM policy, and first-deployment checklist.

### Custom domain

Set `dashboard_domain` (e.g. `dls.rpras.my.id`) in `terraform.tfvars`. Terraform then:

- creates an **ACM certificate in us-east-1** (CloudFront requirement) and exposes `dashboard_certificate_validation_records`;
- adds the domain as a CloudFront **alias** with `TLSv1.2_2021` once the certificate is issued.

Because DNS is managed outside AWS, add two **DNS-only** CNAME records in the DNS provider (Cloudflare in this deployment):

1. the ACM validation record from `dashboard_certificate_validation_records`;
2. `dls` → `dashboard_cloudfront_domain` (e.g. `d35ludv1nb7o7i.cloudfront.net`).

The dashboard is served at `https://dls.rpras.my.id`; CloudFront redirects HTTP to HTTPS.

## Batch replay upload

`scripts/upload-replays.sh` uploads every `<match_id>.dem` in a replay folder to `raw/`, skipping replays already present in S3 (unless `--force`). Each upload triggers the parser → aggregator chain automatically.

```bash
scripts/upload-replays.sh --dry-run        # show the plan, change nothing
scripts/upload-replays.sh                  # upload every missing replay
scripts/upload-replays.sh --latest 3       # only the 3 newest files
scripts/upload-replays.sh --since 2026-09-28
scripts/upload-replays.sh --files a.dem b.dem
scripts/upload-replays.sh --wait           # upload, then await parsed/*.json
```

`--bucket`, `--profile`, `--region`, and `--source` override the defaults; the same values can be set through the `S3_BUCKET`, `AWS_PROFILE_NAME`, `AWS_REGION_NAME`, and `DOTA_REPLAY_DIR` environment variables.

## Adding replay data features

There are three different change paths. Choose the smallest path that contains
the new data:

### Field already exists in `parsed/`

If the normalized field already exists, update only `aggregator/aggregator.py`.
Deploy the aggregator ZIP and invoke one full rebuild. No replay parsing is
needed because the aggregator reads the existing parsed history.

```text
parsed/*.json -> Aggregator Lambda -> stats.json/matches.json -> dashboard
```

### Field exists only in the raw replay

If the field is available in the `.dem` parser event stream but is not present
in `parsed/*.json`:

1. Add extraction and normalization in `parser/normalize.py`.
2. Bump the parser `SCHEMA_VERSION`.
3. Build and deploy the parser container image.
4. Reprocess old raw objects without changing them; see the next section.
5. The newly written parsed JSON automatically triggers the full aggregator.
6. Add the field to `web/src/types/stats.ts` and the relevant component if it
   needs to be displayed.

The parser schema and aggregate schema are independent. The parser currently
uses an integer schema version, while the dashboard aggregate publishes its
own string `metadata.schema_version`.

### Field already exists in `stats.json`

If the backend payload already contains the new field, update the React types
and components, run `npm run build`, upload the static assets, and invalidate
CloudFront. No parser or aggregator rebuild is required.

## Reprocess without uploading a replay

Deploying a new parser image does not automatically execute it against old
objects. To reprocess without uploading or modifying `raw/*.dem`, invoke the
Parser Lambda directly with the same S3 event shape normally emitted by S3:

```bash
aws lambda invoke \
  --function-name dota-replay-parser \
  --invocation-type RequestResponse \
  --cli-binary-format raw-in-base64-out \
  --payload '{"Records":[{"s3":{"bucket":{"name":"<bucket>"},"object":{"key":"raw/<match_id>.dem"}}}]}' \
  /tmp/parser-response.json \
  --profile <profile> \
  --region <region>
```

The parser downloads the existing raw object, checks its parsed schema, and
rewrites only `parsed/<match_id>.json` when the schema is stale. That parsed
write emits the existing `parsed/` S3 notification, so the aggregator rebuilds
the full history and republishes both dashboard payloads. The raw replay is
not uploaded, copied, deleted, or modified.

For multiple objects, invoke the Lambda once per `raw/*.dem` key. A future
batch wrapper should support `--all`, match ID filters, `--schema-before`,
`--dry-run`, and `--wait`; the parser's schema-aware skip check makes invoking
all raw keys safe because current parsed objects are skipped.

The caller needs `lambda:InvokeFunction` for `dota-replay-parser`. The parser
execution role still needs `s3:GetObject` on `raw/*`, `s3:GetObject` on
`parsed/*` for the schema check, and `s3:PutObject` on `parsed/*`.

## Data flow when adding a feature

```text
Raw replay feature
    -> parser/normalize.py
    -> parsed/<match_id>.json
    -> Aggregator Lambda reads all parsed files
    -> stats/stats.json and stats/matches.json
    -> dashboard bucket mirror
    -> CloudFront
    -> React component
```

The aggregator never reads `.dem` files. The frontend never reads
`parsed/*.json` directly. This separation keeps replay decoding, historical
aggregation, and presentation independently deployable.

## Implementation order

Matches the plan's recommended order:

1. Collect 3-5 private lobby replay files
2. Test the parser locally (`docker run` + mount a `.dem`, or run the jar directly with a JVM)
3. Build the Lambda container image
4. Push the image to ECR
5. Create the S3 bucket (`terraform apply` targeting `s3.tf`/`ecr.tf`, or full apply once image exists)
6. Deploy the Lambda container
7. Confirm the S3 `ObjectCreated` trigger (created by Terraform)
8. Upload one replay
9. Validate the parsed JSON against `samples/parsed-example.json`
10. Benchmark memory/runtime via CloudWatch metrics
11. Test 3-5 additional replays
12. Finalize the MVP parser

## Status

Implemented and deployed:

- **MVP 1** — S3 raw storage, Lambda container replay parsing, normalized `parsed/<match_id>.json` output.
- **MVP 2** — full-rebuild aggregator producing dashboard-ready `stats/stats.json` (summary, players, heroes, player-heroes, teammates, head-to-head, leaderboards).
- **Dashboard** — React + TypeScript SPA (Vite + Tailwind v4, TanStack Router) served from a private S3 bucket via CloudFront (HTTPS, OAC), with a shareable player profile page at `/player/<id>`.
- **Replay upload** — an **Upload replay** button in the dashboard: a shared-password gate, current-duplicate protection, stale-schema reprocessing support, direct-to-S3 presigned uploads, and live parse progress.
- **Role analytics** — parser telemetry extraction, lane/role heuristic, role-specific aggregate scoring, and Best Support/Offlane/Carry dashboard cards.

The parser now extracts selected advanced telemetry (economy, damage, wards,
stuns, early positions, and role signals). Full timelines and raw combat-log
visualization remain out of scope. There are no player accounts — the upload
password is a shared gate, not authentication.
