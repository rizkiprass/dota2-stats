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
|   +-- normalize.py       Converts raw odota/parser line-delimited JSON into MVP match.json schema
|   +-- requirements.txt
|
+-- aggregator/            ZIP Lambda for deterministic historical statistics rebuilds
|   +-- aggregator.py      Lists parsed JSON, validates/deduplicates, then writes stats/stats.json
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
|   +-- dashboard.tf      Static website bucket for the dashboard
|
+-- web/                  Vanilla static dashboard (HTML/CSS/JS)
|   +-- index.html
|   +-- styles.css
|   +-- app.js            Fetches stats.json and renders summaries/leaderboards/tables
|   +-- heroes.js         hero_id -> Dota CDN slug, for hero artwork
|
+-- scripts/
|   +-- upload-replays.sh Batch-upload .dem replays to s3://<bucket>/raw/
|
+-- samples/
|   +-- parsed-example.json
|
+-- docs/
|   +-- architecture.md
|   +-- ai-frontend-setup.md  OpenCode agents/skills and the frontend workflow
|   +-- ai-frontend-setup.md  OpenCode agents/skills and the frontend workflow
|
+-- dota_replay_mvp_plan.md
+-- README.md
```

## How it works

1. A `.dem` replay is uploaded manually to `s3://<bucket>/raw/<match_id>.dem`.
2. S3 emits an `ObjectCreated` event (filtered to `raw/` prefix, `.dem` suffix) which invokes the Lambda function.
3. The Lambda container:
   - Downloads the replay to `/tmp/<match_id>.dem`.
   - Runs the bundled [`odota/parser`](https://github.com/odota/parser) Java jar (`java -jar parser.jar --file /tmp/<match_id>.dem`), which streams the replay through [Clarity](https://github.com/skadistats/clarity) and prints line-delimited JSON match events to stdout.
   - Normalizes the event stream into the minimal MVP schema (match info + 10 players).
   - Writes `/tmp/<match_id>.json` and uploads it to `s3://<bucket>/parsed/<match_id>.json`.
4. The aggregator Lambda is triggered by the new `parsed/<match_id>.json`; it lists every `parsed/*.json`, skips invalid and duplicate `match_id` values, recalculates all statistics, and overwrites `stats/stats.json`.
5. The original `.dem` file is always retained in `raw/` as the source of truth.

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

> Note: Terraform provisions the Lambda function pointing at the ECR image tag. Push the image (step 1) **before** running `terraform apply`, otherwise Lambda creation will fail because the image doesn't exist yet.

### 3. Test

```bash
aws s3 cp samples/some-replay.dem s3://<bucket>/raw/<match_id>.dem
aws s3 cp s3://<bucket>/parsed/<match_id>.json - | jq .
```

Check CloudWatch Logs (`/aws/lambda/dota-replay-parser`) for parse duration, replay size, and any errors.

## Dashboard

A vanilla static dashboard (no build step) reads `stats.json` and renders the summary, leaderboards, and player/hero/teammate/head-to-head tables.

> Working on the dashboard with AI assistance? See [`docs/ai-frontend-setup.md`](./docs/ai-frontend-setup.md) for the OpenCode agents (`frontend`, `visual-reviewer`, `quick-edit`), the `design-system` skill, and the screenshot-review workflow.

- Terraform creates a dedicated, public-read S3 website bucket (`dashboard.tf`) — separate from the private data bucket.
- The aggregator mirrors every `stats/stats.json` payload to `stats.json` in the website bucket, so the page always shows the latest rebuild with no cross-bucket CORS.
- Deploy the frontend with:

  ```bash
  aws s3 sync web/ s3://<dashboard_bucket>/ \
    --exclude "stats.json" --delete \
    --profile <profile> --region <region>
  ```

- The website URL is emitted by Terraform as `dashboard_website_url` (plain HTTP S3 website endpoint). `GET /stats.json` is served same-origin from the website bucket.

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
- **Dashboard** — vanilla static S3 website rendering `stats.json` (summary, leaderboards, detail tables).

Not implemented yet: advanced analytics (timelines, positions, combat logs), custom domain/HTTPS via CloudFront, and authentication.
