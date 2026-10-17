# Architecture

## Current Flow

A replay reaches `raw/` in one of two ways: the batch script
(`scripts/upload-replays.sh`) or the dashboard's **Upload replay** button. The
button path is:

```text
Browser (dashboard)
      |
      | POST /replays   (X-Upload-Token; filename -> match_id)
      v
+----------------------------------------------------------+
| API Gateway HTTP API -> Lambda: dota-replay-upload-api    |
|  1. verify the shared upload password                     |
|  2. reject when raw/<match_id>.dem or parsed/<id>.json    |
|     already exists (409)                                  |
|  3. otherwise return a presigned S3 POST                  |
+---------------------------+------------------------------+
                            | browser uploads straight to S3
                            v
                  raw/<match_id>.dem  ->  (flow below)
```

Duplicate uploads are refused before any bytes are sent, and the parser skips a
match whose `parsed/` object already exists, so a duplicate is never parsed
twice.

Once the replay is in `raw/`, both entry points converge on the same pipeline:

```text
Developer / Dota 2 Replay Folder
             |
             | upload <match_id>.dem
             v
+--------------------------------------------------------+
| Amazon S3: dta-replay-data-rizkiprass-2026             |
|                                                        |
| raw/<match_id>.dem                                     |
+---------------------------+----------------------------+
                            |
                            | S3 ObjectCreated
                            | prefix: raw/, suffix: .dem
                            v
+--------------------------------------------------------+
| Lambda: dota-replay-parser (container image)           |
|                                                        |
| 1. Download replay from raw/ to /tmp                   |
| 2. Run odota/parser Java CLI                           |
| 3. Normalize events into match JSON                    |
| 4. Upload parsed/<match_id>.json                       |
+---------------------------+----------------------------+
                            |
                            | S3 ObjectCreated
                            | prefix: parsed/, suffix: .json
                            v
+--------------------------------------------------------+
| Lambda: dota-replay-aggregator (Python ZIP)            |
|                                                        |
| 1. List every parsed/*.json object                     |
| 2. Read, validate, and deduplicate by match_id         |
| 3. Rebuild all historical statistics from scratch      |
| 4. Overwrite stats/stats.json                          |
+---------------------------+----------------------------+
                            |
                            v
+--------------------------------------------------------+
| Amazon S3                                               |
|                                                        |
| stats/stats.json                                       |
| dashboard-ready historical statistics                  |
+---------------------------+----------------------------+
                            |
                            | aggregator mirrors the payload
                            v
+--------------------------------------------------------+
| Amazon S3: dta-replay-dashboard-rizkiprass-2026         |
|                                                        |
| index.html, app.js, styles.css, stats.json             |
| public-read static website (browser fetches same-origin)|
+--------------------------------------------------------+
```

`stats/stats.json` is under the `stats/` prefix, so it matches neither S3 notification filter and cannot retrigger the parser or aggregator.

One rebuild publishes two objects. `stats.json` carries the aggregate dashboard payload plus
`metadata.thresholds`, so clients read the leaderboard minimums instead of duplicating them.
`matches.json` carries the newest `MATCHES_LIMIT` matches (default 500) so history can grow without
inflating the payload the dashboard always fetches. A failure to publish `matches.json` is logged and
never loses the aggregate; only the leaderboard detail pages are affected.

## S3 Data Layout

```text
dta-replay-data-rizkiprass-2026/          # private data bucket
|
+-- raw/
|   +-- 8987451980.dem              # Original replay source of truth
|
+-- parsed/
|   +-- 8987451980.json             # Normalized one-match data
|
+-- parse-failed/
|   +-- 8987451980.json             # Parse-failure marker (read by the upload API)
|
+-- stats/
    +-- stats.json                   # Rebuilt dashboard payload
    +-- matches.json                 # Capped, newest-first per-match list

dta-replay-dashboard-rizkiprass-2026/     # public-read website bucket
|
+-- index.html, styles.css, app.js   # Static dashboard frontend
+-- stats.json                       # Mirror of stats/stats.json, fetched same-origin
+-- matches.json                     # Mirror of stats/matches.json, fetched lazily by
                                     # leaderboard detail pages
```

## Components

| Component | Responsibility |
|---|---|
| Amazon S3 | Stores replay sources, normalized matches, and the one dashboard payload. |
| `dota-replay-parser` Lambda | Parses one new `.dem` replay and writes its normalized JSON. |
| `dota-replay-aggregator` Lambda | Rebuilds all statistics from every valid parsed match when a parsed JSON object is created, and mirrors the payload to the dashboard bucket. |
| `dota-replay-upload-api` Lambda (Amazon API Gateway HTTP API) | Validates the shared upload password, rejects duplicate matches, and issues presigned S3 POSTs so the browser uploads replays directly. |
| Dashboard website bucket | Serves the static HTML/CSS/JS plus same-origin `stats.json` and `matches.json` copies over the S3 website endpoint. |
| Amazon ECR | Stores the parser Lambda container image. |
| Amazon CloudWatch Logs | Stores parser/aggregator execution logs and Lambda metrics. |
| IAM | Applies separate least-privilege roles to the parser and aggregator. |

## Parser Lambda (MVP 1)

The parser runs as a container image and is triggered only for `raw/*.dem` uploads.

```text
Parser container
|
+-- Python handler.py
|   +-- Downloads the S3 replay with boto3
|   +-- Invokes the Java parser subprocess
|   +-- Logs successful/failed parse metadata
|
+-- Java 21 runtime
|   +-- odota/parser via opendota.FileParse
|   +-- Clarity replay decoding
|
+-- normalize.py
    +-- Converts line-delimited parser events into one match object
```

The parser output is stored at `parsed/<match_id>.json` and has this practical contract:

```json
{
  "match_id": "8987451980",
  "duration": 1713,
  "radiant_win": false,
  "start_time": 1788791908,
  "game_mode": 23,
  "players": [
    {
      "account_id": "104623015",
      "steam_id": "76561198064888743",
      "player_name": "Player name",
      "hero_id": 103,
      "team": "radiant",
      "kills": 4,
      "deaths": 6,
      "assists": 7,
      "win": false
    }
  ]
}
```

`start_time` currently uses a Unix epoch value. MVP 2 supports this existing output format; it does not require a `schema_version` field in the input object.

If parsing fails, the original replay remains under `raw/`. The parser logs the error and the replay can be uploaded again after the issue is fixed.

## Aggregator Lambda (MVP 2)

The aggregator runs as a Python 3.13 ZIP Lambda and is triggered only for `parsed/*.json`. Its strategy is a **full historical rebuild**, not incremental state updates.

```text
New parsed match
       |
       v
List every parsed/*.json object
       |
       v
Validate each object and skip invalid matches
       |
       v
Keep only the first occurrence of each match_id
       |
       v
Aggregate all valid unique matches
       |
       v
Serialize and overwrite stats/stats.json
```

This eliminates persistent counters and prevents double-counting when a parsed JSON object is uploaded again. The aggregate data is deterministic for the same set of unique match inputs; only `metadata.generated_at` changes per rebuild.

### Validation and identity rules

A parsed match is skipped if it does not have:

- a `match_id`, numeric `duration`, and boolean `radiant_win`;
- exactly 10 players;
- for every player: `hero_id`, valid `radiant`/`dire` team, numeric K/D/A, and boolean `win`.

Player identity uses `account_id`, never `player_name`. A player with no `account_id` still contributes to the match summary and hero pick statistics, but is excluded from long-term player, player-hero, teammate, and head-to-head statistics.

`player_name` is carried through as a display-only label (the most recent non-empty name seen per `account_id`) in `players` and `player_heroes`, and `hero_name` is attached to each `heroes` entry from a static `hero_id`-to-name table. Neither field affects identity or any aggregation math.

### Generated statistics

`stats/stats.json` contains:

```text
metadata
summary
players
heroes
player_heroes
teammates
head_to_head
leaderboards
```

The aggregator calculates global totals and win rates, per-player K/D/A and KDA, hero pick/win rates, per-player hero records, teammate combinations, and Radiant-vs-Dire head-to-head pairs. Leaderboards use these minimum sample thresholds:

```text
Players:        5 matches
Heroes:         5 picks
Teammate pairs: 3 matches
H2H pairs:      3 matches
```

These thresholds are configurable through the aggregator's `MIN_PLAYER_MATCHES`, `MIN_HERO_PICKS`, `MIN_TEAMMATE_MATCHES`, and `MIN_H2H_MATCHES` environment variables. The current deployment temporarily lowers all of them to `2` so the leaderboards are populated for the small early dataset; raise them back toward the defaults as history grows.

## IAM Boundaries

The parser and aggregator use different execution roles.

| Lambda | Allowed S3 access |
|---|---|
| Parser | Read `raw/*`; write `parsed/*`; read `parsed/*` (skip already-parsed); write `parse-failed/*`; list `raw/*` and `parsed/*`. |
| Aggregator | List/read `parsed/*`; write `stats/*`. No access to `raw/*`. |
| Upload API | Read `raw/*`, `parsed/*`, `parse-failed/*` (duplicate + status checks); write `raw/*` (signs the presigned POSTs). |

Both functions can write their own CloudWatch Logs through the AWS managed Lambda basic execution policy.

## Operational Checks

After uploading a replay to `raw/<match_id>.dem`, check the generated artifacts:

```bash
aws s3 cp "s3://<bucket>/parsed/<match_id>.json" - | jq .
aws s3 cp "s3://<bucket>/stats/stats.json" - | jq '.summary, .metadata'
```

Useful CloudWatch log groups:

```text
/aws/lambda/dota-replay-parser
/aws/lambda/dota-replay-aggregator
```

## Out of Scope

The system intentionally has no database, DynamoDB, Athena, Glue, SQS, Step Functions, or ECS. The only API surface is the replay upload API — a single API Gateway HTTP API in front of the upload Lambda — and there are no player accounts: uploads are gated by a shared password, not authentication. Advanced analytics (timelines, positions, combat logs) remain out of scope.

## AI-assisted frontend development

The dashboard is maintained with the read-only `visual-reviewer` agent and the shared `design-system` skill defined under `.opencode/`. Verification is two-part: `npm run test:ui` (Playwright) asserts content, console cleanliness, and no horizontal overflow, while `scripts/orca-shot.sh` captures screenshots of the running SPA through the Orca browser and hands them to `visual-reviewer` for a visual critique.
