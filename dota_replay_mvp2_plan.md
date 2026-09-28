# Dota 2 Private Lobby Statistics – MVP 2 Plan

## 1. MVP 2 Objective

Build a lightweight statistics aggregation layer on top of the parsed replay JSON files produced by MVP 1.

The main objective is:

> Read all parsed match JSON files from Amazon S3, calculate reusable statistics from scratch, and generate a single `stats.json` file that can later be consumed directly by a web dashboard.

The MVP 2 design intentionally avoids databases and query engines.

## 2. Architecture

```text
                    MVP 1
                      |
                      v
                Replay .dem
                      |
                      v
                  S3 raw/
                      |
                      v
               Lambda Parser
                      |
                      v
               S3 parsed/
                      |
              ObjectCreated
                      |
                      v
             Lambda Aggregator
                      |
              Read all parsed
                      |
                      v
              Calculate Stats
                      |
                      v
              S3 stats/stats.json
```

## 3. AWS Services

| Service | Purpose |
|---|---|
| Amazon S3 | Store parsed match JSON and aggregated statistics |
| AWS Lambda | Run statistics aggregation |
| Amazon CloudWatch | Store logs and execution metrics |
| IAM | Control access between Lambda and S3 |

MVP 2 does not require DynamoDB, Athena, Glue, SQS, Step Functions, ECS Fargate, or API Gateway.

## 4. Responsibility Separation

### MVP 1 Responsibility

Input:

```text
match.dem
```

Output:

```text
parsed/<match_id>.json
```

Responsibility:

```text
Replay -> Structured Match Data
```

### MVP 2 Responsibility

Input:

```text
parsed/*.json
```

Output:

```text
stats/stats.json
```

Responsibility:

```text
Many Match JSON Files -> Historical Statistics
```

## 5. S3 Structure

```text
dota-replay-data/
|
+-- raw/
|   +-- 8938123456.dem
|
+-- parsed/
|   +-- 8938123456.json
|   +-- 8938123457.json
|   +-- 8938123458.json
|
+-- stats/
    +-- stats.json
```

## 6. Aggregation Strategy

Use a full rebuild strategy.

```text
New parsed match created
        |
        v
Aggregator starts
        |
        v
List all parsed/*.json
        |
        v
Read every valid match
        |
        v
Recalculate all statistics
        |
        v
Overwrite stats/stats.json
```

Advantages:

- Easy to debug
- Easy to validate
- No double-counting state
- Easy to change formulas
- Easy to reprocess historical data
- No database required

## 7. Parsed Match Contract

Recommended minimum input:

```json
{
  "schema_version": "1.0",
  "match_id": "8938123456",
  "duration": 2518,
  "start_time": "2026-09-12T10:30:00Z",
  "radiant_win": true,
  "players": [
    {
      "account_id": "123456789",
      "steam_id": "76561198000000001",
      "player_name": "Budi",
      "hero_id": 2,
      "team": "radiant",
      "kills": 10,
      "deaths": 3,
      "assists": 15,
      "win": true
    }
  ]
}
```

## 8. Player Identity

Do not use `player_name` as the primary identity.

Use `account_id` or `steam_id`, with `account_id` as the recommended canonical key.

## 9. Statistics Categories

Generate:

1. Global Summary
2. Player Statistics
3. Hero Statistics
4. Player-Hero Statistics
5. Teammate Statistics
6. Head-to-Head Statistics
7. Leaderboards

## 10. Global Summary

Fields:

```text
total_matches
total_players
total_hero_picks
average_duration_seconds
radiant_wins
dire_wins
radiant_win_rate
dire_win_rate
```

Example:

```json
{
  "summary": {
    "total_matches": 42,
    "total_players": 18,
    "total_hero_picks": 420,
    "average_duration_seconds": 2475,
    "radiant_wins": 22,
    "dire_wins": 20,
    "radiant_win_rate": 52.38,
    "dire_win_rate": 47.62
  }
}
```

## 11. Player Statistics

Fields:

```text
matches
wins
losses
win_rate
kills
deaths
assists
avg_kills
avg_deaths
avg_assists
kda
```

Formula:

```text
win_rate = wins / matches * 100
avg_kills = kills / matches
avg_deaths = deaths / matches
avg_assists = assists / matches
kda = (kills + assists) / max(deaths, 1)
```

## 12. Hero Statistics

Fields:

```text
hero_id
picks
wins
losses
win_rate
```

Example:

```json
{
  "heroes": {
    "2": {
      "hero_id": 2,
      "picks": 21,
      "wins": 12,
      "losses": 9,
      "win_rate": 57.14
    }
  }
}
```

## 13. Player-Hero Statistics

Fields:

```text
matches
wins
losses
win_rate
kills
deaths
assists
kda
```

This enables most-played hero, best hero, per-hero win rate, and per-hero KDA for each player.

## 14. Teammate Statistics

For each five-player team, generate every two-player combination.

```text
C(5,2) = 10 teammate pairs per team
```

With two teams:

```text
20 teammate observations per match
```

Canonical pair key:

```text
123#789
```

Always sort player IDs before creating the key.

Example:

```json
{
  "teammates": {
    "123#789": {
      "player_a": "123",
      "player_b": "789",
      "matches": 12,
      "wins": 8,
      "losses": 4,
      "win_rate": 66.67
    }
  }
}
```

## 15. Head-to-Head Statistics

For each Radiant player, compare against every Dire player.

```text
5 x 5 = 25 opponent pairs per match
```

Example:

```json
{
  "head_to_head": {
    "123#456": {
      "player_a": "123",
      "player_b": "456",
      "matches": 10,
      "player_a_wins": 6,
      "player_b_wins": 4,
      "player_a_win_rate": 60.0,
      "player_b_win_rate": 40.0
    }
  }
}
```

## 16. Leaderboards

Recommended leaderboard categories:

```text
most_matches
highest_win_rate
most_kills
best_kda
most_assists
most_picked_hero
best_hero_win_rate
best_duo_win_rate
most_played_duo
most_played_rivalry
```

Recommended thresholds:

```text
MIN_PLAYER_MATCHES = 5
MIN_HERO_PICKS = 5
MIN_TEAMMATE_MATCHES = 3
MIN_H2H_MATCHES = 3
```

## 17. Final stats.json Structure

```json
{
  "metadata": {
    "generated_at": "2026-09-12T18:00:00Z",
    "schema_version": "1.0",
    "source_match_count": 42
  },
  "summary": {},
  "players": {},
  "heroes": {},
  "player_heroes": {},
  "teammates": {},
  "head_to_head": {},
  "leaderboards": {}
}
```

## 18. Aggregator Algorithm

```text
START
 |
 v
List S3 parsed/*.json
 |
 v
Initialize aggregation structures
 |
 v
For each parsed match
 |
 +-- validate match
 +-- deduplicate by match_id
 +-- update global summary
 +-- update player stats
 +-- update hero stats
 +-- update player-hero stats
 +-- split Radiant and Dire
 +-- generate teammate pairs
 +-- generate H2H pairs
 |
 v
Finalize derived metrics
 |
 +-- win rates
 +-- averages
 +-- KDA
 |
 v
Generate leaderboards
 |
 v
Serialize stats.json
 |
 v
Upload to S3 stats/stats.json
 |
 END
```

## 19. Python Pseudocode

```python
matches = load_all_matches_from_s3()

stats = initialize_stats()
processed_match_ids = set()

for match in matches:
    validate_match(match)

    match_id = match["match_id"]

    if match_id in processed_match_ids:
        continue

    processed_match_ids.add(match_id)

    update_summary(stats, match)

    for player in match["players"]:
        update_player_stats(stats, player)
        update_hero_stats(stats, player)
        update_player_hero_stats(stats, player)

    radiant = [p for p in match["players"] if p["team"] == "radiant"]
    dire = [p for p in match["players"] if p["team"] == "dire"]

    update_teammate_pairs(stats, radiant)
    update_teammate_pairs(stats, dire)
    update_head_to_head(stats, radiant, dire)

finalize_metrics(stats)
generate_leaderboards(stats)
upload_stats_to_s3(stats)
```

## 20. Trigger

Configure S3 ObjectCreated for:

```text
Prefix: parsed/
Suffix: .json
```

Flow:

```text
parsed/<match_id>.json
        |
        v
Lambda Aggregator
        |
        v
stats/stats.json
```

Because the output path is under `stats/`, it will not retrigger itself.

## 21. Lambda Configuration

Recommended starting configuration:

```text
Runtime           : Python 3.13
Memory            : 1024 MB
Timeout           : 300 seconds
Ephemeral Storage : 512 MB
Architecture      : x86_64
```

A standard ZIP Lambda is sufficient.

## 22. IAM Permissions

Required:

```text
s3:ListBucket
s3:GetObject
s3:PutObject
```

Scope:

```text
READ:
dota-replay-data/parsed/*

WRITE:
dota-replay-data/stats/*
```

No access to `raw/*` is required.

## 23. Validation Rules

Match-level:

```text
match_id exists
players exists
players is a list
player count == 10
radiant_win exists
duration exists
```

Player-level:

```text
account_id exists
hero_id exists
team is radiant or dire
kills numeric
deaths numeric
assists numeric
win boolean
```

Invalid matches should be skipped and logged.

## 24. Anonymous Players

If `account_id = null`:

```text
Count the match globally
Skip the player from long-term player statistics
Skip teammate/H2H pairs involving that player
```

Do not fall back to player name as identity.

## 25. Duplicate Protection

Maintain:

```python
processed_match_ids = set()
```

and skip any duplicate `match_id`.

## 26. Schema Versioning

Use:

```json
{
  "schema_version": "1.0"
}
```

for both parsed input and aggregated output.

## 27. Logging

Recommended CloudWatch log summary:

```text
Aggregation started
Parsed files found: 42
Valid matches: 41
Invalid matches: 1
Duplicate matches skipped: 0
Unique players: 18
Unique heroes: 76
Teammate pairs: 112
Head-to-head pairs: 138
stats.json size: 231 KB
Aggregation duration: 2.31 seconds
Aggregation completed
```

## 28. Testing Strategy

### Test 1 – Single Match

Validate:

```text
total_matches = 1
total_players = 10
total_hero_picks = 10
```

### Test 2 – Same Players, Same Teams

Validate player and teammate aggregation.

### Test 3 – Same Players, Opposite Teams

Verify that the same two players can be teammates in one match and opponents in another.

### Test 4 – Different Players

Validate dynamic roster handling.

### Test 5 – Same Player, Different Heroes

Validate player-hero aggregation.

### Test 6 – Duplicate Match

Validate one-count-only behavior.

### Test 7 – Invalid Match

Validate skip-and-log behavior.

## 29. Benchmark Metrics

Track:

| Metric | Purpose |
|---|---|
| Number of parsed files | Data volume |
| Number of valid matches | Data quality |
| Number of unique players | Relationship scale |
| Aggregation duration | Lambda sizing |
| Peak memory | Lambda optimization |
| stats.json size | Dashboard payload sizing |
| Invalid match count | Parser quality |

## 30. Recommended Code Structure

```text
mvp2-aggregator/
|
+-- aggregator.py
|
+-- handlers/
|   +-- s3_handler.py
|
+-- aggregation/
|   +-- summary.py
|   +-- players.py
|   +-- heroes.py
|   +-- player_heroes.py
|   +-- teammates.py
|   +-- head_to_head.py
|   +-- leaderboards.py
|
+-- validation/
|   +-- match_validator.py
|
+-- tests/
|   +-- test_summary.py
|   +-- test_players.py
|   +-- test_pairs.py
|   +-- test_head_to_head.py
|
+-- requirements.txt
+-- README.md
```

For the first implementation, all logic can stay in `aggregator.py` and be split later.

## 31. Recommended Repository Structure

```text
dota-lobby-statistics/
|
+-- parser/
|   +-- Dockerfile
|   +-- handler.py
|
+-- aggregator/
|   +-- aggregator.py
|   +-- requirements.txt
|
+-- terraform/
|   +-- s3.tf
|   +-- parser_lambda.tf
|   +-- aggregator_lambda.tf
|   +-- iam.tf
|   +-- triggers.tf
|
+-- samples/
|   +-- parsed-match.json
|   +-- stats.json
|
+-- tests/
|
+-- docs/
|   +-- mvp1-plan.md
|   +-- mvp2-plan.md
|
+-- README.md
```

## 32. Definition of Done

MVP 2 is complete when:

1. All valid parsed matches can be read from S3.
2. Duplicate `match_id` values are counted only once.
3. Player identity is based on account/Steam ID.
4. Changing lobby participants are supported.
5. Global summary statistics are correct.
6. Player win/loss statistics are correct.
7. Player K/D/A and KDA are correct.
8. Hero pick and win-rate statistics are correct.
9. Player-hero statistics are correct.
10. Teammate pair statistics are correct.
11. Head-to-head statistics are correct.
12. Minimum-match leaderboard filters work.
13. Invalid matches do not stop aggregation.
14. `stats.json` is generated automatically.
15. A full historical rebuild produces deterministic results.
16. `stats.json` can be consumed directly by the future dashboard.

## 33. Final Architecture

```text
                  Dota Replay
                       |
                       v
                   S3 raw/
                       |
                       v
                Lambda Parser
                       |
                       v
                 S3 parsed/
                       |
                ObjectCreated
                       |
                       v
              Lambda Aggregator
                       |
          +------------+------------+
          |                         |
          v                         v
     Read all matches          Aggregate
          |                         |
          +------------+------------+
                       |
                       v
                  stats.json
                       |
                       v
                   S3 stats/
```

## 34. Next Phase

After `stats.json` is stable:

```text
stats.json
    |
    v
Static React Web App
    |
    v
Amazon S3 + CloudFront
```

No API backend or database is required yet.

## 35. Main Milestone

> Parsed Dota private-lobby matches → deterministic historical statistics → one dashboard-ready `stats.json`.
