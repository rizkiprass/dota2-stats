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
+-- terraform/            Infrastructure as code (S3, ECR, Lambda, IAM)
|   +-- main.tf
|   +-- variables.tf
|   +-- outputs.tf
|   +-- s3.tf
|   +-- ecr.tf
|   +-- lambda.tf
|   +-- iam.tf
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

This repository implements the MVP scope from the plan (Section 2-12): S3 raw storage, Lambda container parsing, and normalized JSON output. Phase 2 (aggregated stats), Phase 3 (dashboard), and Phase 4 (advanced analytics) are intentionally not implemented yet.
