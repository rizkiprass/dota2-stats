# Dota 2 Private Lobby Statistics – MVP Plan

## 1. Project Objective

Build a low-cost Dota 2 private lobby statistics platform on AWS.

The first objective is intentionally minimal:

> Upload a Dota 2 replay file (`.dem`), parse it automatically using AWS Lambda Container, and store the parsed match result as JSON in Amazon S3.

The initial MVP will not use a database, Athena, Glue, ECS, SQS, or a web dashboard.

---

## 2. MVP Scope

### In Scope

- Manual upload of Dota 2 replay `.dem`
- Store replay files in Amazon S3
- Trigger Lambda automatically when a replay is uploaded
- Parse replay using a containerized replay parser
- Extract basic match information
- Store parsed result as JSON in S3
- Keep the original `.dem` file as the raw source of truth

### Out of Scope for MVP

- OpenDota API
- Steam Game Coordinator automation
- Automatic replay download
- DynamoDB
- Amazon Athena
- AWS Glue
- SQS
- Step Functions
- ECS Fargate
- Authentication
- React dashboard
- Advanced combat-log analytics

---

## 3. Target Architecture

```text
Manual Replay Upload
        |
        v
+-------------------+
|     Amazon S3     |
|                   |
| raw/*.dem         |
+---------+---------+
          |
          | S3 ObjectCreated
          v
+--------------------------+
| AWS Lambda Container     |
|                          |
| - Download replay        |
| - Parse .dem             |
| - Normalize basic data   |
| - Generate JSON          |
+------------+-------------+
             |
             v
+---------------------------+
|        Amazon S3          |
|                           |
| parsed/*.json             |
+---------------------------+
```

---

## 4. AWS Services

| Service | Purpose |
|---|---|
| Amazon S3 | Store raw replay files and parsed JSON |
| AWS Lambda | Run the replay parser |
| Amazon ECR | Store the Lambda container image |
| Amazon CloudWatch | Store Lambda logs and metrics |
| IAM | Control access between Lambda, S3, ECR, and CloudWatch |

---

## 5. S3 Structure

Recommended initial bucket structure:

```text
dota-replay-data/
|
+-- raw/
|   +-- 8938123456.dem
|   +-- 8938129999.dem
|
+-- parsed/
    +-- 8938123456.json
    +-- 8938129999.json
```

The `.dem` replay should always be retained.

It becomes the raw source of truth and allows replay data to be reprocessed in the future when parser logic changes.

---

## 6. Minimum Parsed Data

The MVP should initially extract only data required for basic statistics.

### Match Information

```text
match_id
duration
radiant_win
start_time
game_mode
```

### Player Information

For each of the 10 players:

```text
account_id
steam_id
player_name
hero_id
team
kills
deaths
assists
win
```

Additional fields can be added after the basic parser works reliably.

---

## 7. Example Output

Example:

```json
{
  "match_id": "8938123456",
  "duration": 2518,
  "radiant_win": true,
  "players": [
    {
      "account_id": "123456789",
      "player_name": "Player A",
      "hero_id": 2,
      "team": "radiant",
      "kills": 12,
      "deaths": 4,
      "assists": 18,
      "win": true
    },
    {
      "account_id": "987654321",
      "player_name": "Player B",
      "hero_id": 14,
      "team": "dire",
      "kills": 7,
      "deaths": 8,
      "assists": 10,
      "win": false
    }
  ]
}
```

---

## 8. Lambda Configuration

Initial recommended configuration:

```text
Runtime           : Container Image
Architecture      : x86_64
Memory            : 4096 MB
Ephemeral Storage : 4096 MB
Timeout           : 900 seconds
Reserved Concurrency: 1
```

These values should be treated as starting points.

After testing several real replay files, memory and ephemeral storage can be reduced if possible.

---

## 9. Lambda Processing Flow

When a replay is uploaded:

```text
1. S3 receives raw/<match_id>.dem

2. S3 triggers Lambda

3. Lambda downloads replay to:

   /tmp/<match_id>.dem

4. Lambda starts replay parser

5. Parser extracts match and player information

6. Lambda normalizes parser output

7. Lambda creates:

   /tmp/<match_id>.json

8. Lambda uploads result to:

   parsed/<match_id>.json

9. Lambda invocation finishes
```

---

## 10. Lambda Container Design

Recommended container structure:

```text
Lambda Container
|
+-- Python runtime / handler
|
+-- Java runtime
|
+-- Dota replay parser
|
+-- Parser dependencies
|
+-- AWS SDK
```

Recommended responsibility split:

```text
Python
  |
  +-- S3 download
  +-- S3 upload
  +-- parser orchestration
  +-- output normalization

Java / Replay Parser
  |
  +-- .dem parsing
  +-- Dota event extraction
```

---

## 11. Trigger Configuration

Configure S3 event notification only for:

```text
Prefix : raw/
Suffix : .dem
```

This is important to prevent the Lambda from triggering itself when it writes JSON files into:

```text
parsed/
```

Processing flow:

```text
raw/*.dem
    |
    v
Lambda
    |
    v
parsed/*.json
```

---

## 12. Error Handling

For the MVP, error handling can remain simple.

Lambda should log:

```text
match_id
replay_file
replay_size
parse_start_time
parse_end_time
parse_duration
parser_exit_code
output_size
error_message
```

If parsing fails:

- Keep the raw replay in S3
- Do not delete or overwrite the replay
- Write failure information to CloudWatch Logs
- Retry manually after fixing the parser

SQS and DLQ are intentionally not included in the MVP.

---

## 13. Initial Testing

Use at least 3–5 replay files.

Recommended test cases:

```text
Replay A
Normal private lobby

Replay B
Long match

Replay C
Short match

Replay D
Different group of players

Replay E
Different heroes
```

For every replay, validate:

- Match ID
- Exactly 10 players
- Steam/account ID
- Player name
- Hero
- Radiant / Dire team
- Kills
- Deaths
- Assists
- Winner
- Duration

---

## 14. Benchmark Metrics

Record the following during testing:

| Metric | Purpose |
|---|---|
| Replay file size | Estimate S3 and `/tmp` requirement |
| Parse duration | Determine Lambda suitability |
| Peak memory usage | Optimize Lambda memory |
| Output JSON size | Estimate storage requirement |
| Lambda duration | Estimate cost |
| Parser failures | Determine parser reliability |

Target:

```text
Parse duration < 10 minutes
```

Preferred:

```text
Parse duration < 3 minutes
```

If parsing consistently exceeds 10–12 minutes, evaluate ECS Fargate.

---

## 15. Cost Expectation

For the initial MVP, expected AWS cost should be very low.

Main cost components:

```text
Lambda execution
S3 storage
ECR image storage
CloudWatch logs
```

Example workload:

```text
20 replay files / month
4 GB Lambda memory
3 minutes average parsing time
```

Compute consumption:

```text
20 × 4 GB × 180 seconds
= 14,400 GB-seconds / month
```

This is a very small Lambda workload.

Actual pricing depends on AWS Region, account free-tier availability, container image size, and execution time.

For this project scale, the target operating cost should remain within a few USD per month.

---

## 16. MVP Success Criteria

The MVP is considered successful when:

1. A private lobby `.dem` file can be uploaded to S3.
2. S3 automatically triggers Lambda.
3. Lambda successfully parses the replay.
4. The system detects all 10 players.
5. Player account identity can be extracted consistently.
6. Hero, team, K/D/A, winner, and duration are correct.
7. A normalized JSON file is saved into S3.
8. Processing completes well below the Lambda 15-minute limit.

---

# Phase 2 – Basic Statistics

After replay parsing is stable, add a small aggregation process.

Architecture:

```text
Replay .dem
    |
    v
Lambda Parser
    |
    v
match.json
    |
    v
Stats Aggregator
    |
    v
stats.json
```

No database is required yet.

Example:

```json
{
  "players": {
    "123456789": {
      "matches": 20,
      "wins": 13,
      "losses": 7,
      "win_rate": 0.65
    }
  }
}
```

---

## Phase 2 Statistics

Initial statistics:

### Player Statistics

```text
total matches
wins
losses
win rate
average kills
average deaths
average assists
KDA
```

### Hero Statistics

```text
most picked hero
hero match count
hero win count
hero win rate
player + hero performance
```

### Player Relationship

For every match, compare players based on Steam/account ID.

Statistics:

```text
games together
wins together
win rate together

games against each other
player A wins
player B wins
head-to-head win rate
```

This model supports changing lobby participants automatically.

There is no requirement for the same 10 people to appear in every match.

---

# Phase 3 – Minimal Web Dashboard

Once enough replay files exist:

```text
S3
|
+-- parsed matches
|
+-- stats.json
        |
        v
Static Web App
        |
        v
S3 + CloudFront
```

The web app can initially read a generated static JSON file.

This avoids introducing a database and backend API too early.

Recommended frontend:

```text
React
TypeScript
Vite
Apache ECharts
```

Initial dashboard pages:

```text
Overview
Player Leaderboard
Hero Statistics
Player Detail
Player Synergy
Head-to-Head
Match History
```

---

# Phase 4 – Advanced Analytics

Only implement this after the MVP and dashboard are stable.

Possible replay-derived analytics:

```text
Kill timeline
Death timeline
Item timing
Gold timeline
XP timeline
Tower timing
Roshan control
Ward placement
Teamfight contribution
Kill heatmap
Death heatmap
Player movement
Hero combinations
Player synergy score
Rivalry score
```

At this phase, additional AWS services may become useful:

```text
Athena
DynamoDB
Parquet
Glue Data Catalog
ECS Fargate
```

They should not be introduced until there is a clear requirement.

---

# Implementation Order

Recommended order:

```text
STEP 1
Collect 3–5 private lobby replay files

        ↓

STEP 2
Test replay parser locally

        ↓

STEP 3
Build Lambda container image

        ↓

STEP 4
Push image to Amazon ECR

        ↓

STEP 5
Create S3 bucket

        ↓

STEP 6
Deploy Lambda Container

        ↓

STEP 7
Configure S3 ObjectCreated trigger

        ↓

STEP 8
Upload one replay

        ↓

STEP 9
Validate parsed JSON

        ↓

STEP 10
Benchmark memory and runtime

        ↓

STEP 11
Test 3–5 additional replays

        ↓

STEP 12
Finalize MVP parser
```

---

# Recommended MVP Repository Structure

```text
dota-lobby-statistics/
|
+-- parser/
|   +-- Dockerfile
|   +-- handler.py
|   +-- parser/
|   +-- requirements.txt
|
+-- terraform/
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
+-- README.md
```

---

# Initial Technology Stack

```text
Cloud Provider      AWS

Raw Storage         Amazon S3

Compute             AWS Lambda Container

Container Registry  Amazon ECR

Parser              Dota .dem Replay Parser

Orchestration       Python

Infrastructure      Terraform

Logging             Amazon CloudWatch

Source Control      GitHub
```

---

# Final MVP Architecture

```text
                 MANUAL PROCESS

                Dota 2 Client
                     |
                Download Replay
                     |
                     v
                match.dem
                     |
                     v
                 Amazon S3
                 raw/*.dem
                     |
            S3 ObjectCreated
                     |
                     v
            Lambda Container
             Replay Parser
                     |
              +------+------+
              |             |
              v             v
         Parse Replay    CloudWatch
              |
              v
         Normalize Data
              |
              v
             S3
        parsed/*.json
```

The first milestone is not the dashboard.

The first milestone is:

> **Private Dota lobby replay → AWS → successfully parsed structured JSON.**

Once that pipeline is reliable, the statistics and dashboard layers can be added incrementally without redesigning the raw ingestion architecture.
