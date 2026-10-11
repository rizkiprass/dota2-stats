# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A private, closed circle of Dota 2 players who regularly play **private lobbies (in-houses) together** and want to see the history of their shared games. They browse a personal dashboard to check who has played, win rates, K/D/A, favourite heroes, best duos, and head-to-head rivalries among the same familiar group. The maintainer is a member of the same circle and also operates the pipeline (supplies replays, deploys). There is no public sign-up and no anonymous audience.

## Product Purpose

Turn Dota 2 private-lobby replay files into accurate, persistently available historical statistics that the group can browse in a web dashboard at near-zero running cost. Success means: after a game, a replay is added and the dashboard automatically reflects the group's all-time stats, with no manual data entry and no ongoing infrastructure bill beyond trivial serverless usage.

## Positioning

A fully serverless, database-free pipeline that treats the `.dem` replay as the single source of truth and **deterministically rebuilds one dashboard-ready `stats.json` from scratch on every new match**. A stats app built on a database, persistent counters, or incremental updates could not truthfully claim this combination of zero-state, reproducible history and trivial operating cost.

## Operating Context

- Replays (`.dem`) are collected locally, then uploaded to S3 (`raw/<match_id>.dem`) — manually or via `scripts/upload-replays.sh`.
- An S3 `ObjectCreated` event runs the parser Lambda, which writes `parsed/<match_id>.json`; that in turn triggers the aggregator Lambda, which republishes two objects: `stats/stats.json` (the aggregate) and `stats/matches.json` (a capped, newest-first per-match list).
- The dashboard is a static React SPA served over CloudFront (custom domain `dls.rpras.my.id`), fetching a same-origin `stats.json` on load and `matches.json` lazily when a leaderboard detail page needs per-match history.
- Players are expected to read the dashboard on both desktop and mobile; the maintainer runs build/deploy scripts and reads CloudWatch logs when something fails.
- Only Dota 2 **private lobby** replays are in scope, and they are always supplied manually; no automatic match fetch exists.

## Capabilities and Constraints

- MVP delivered: replay parsing (Lambda container + bundled odota/parser) → normalized match JSON → full historical aggregation → dashboard, plus a detail page per leaderboard category at `/leaderboard/<category>`.
- **Player identity is the numeric `account_id`/`steam_id`, never `player_name`.** A player with no `account_id` still counts toward match summary and hero-pick stats but is excluded from player, player-hero, teammate, and head-to-head statistics.
- `player_name` and `hero_name` are display-only labels and never affect aggregation math.
- Invalid matches are skipped and logged, never allowed to corrupt the aggregate; duplicate `match_id` values are counted once.
- Leaderboards have minimum-sample thresholds (`MIN_PLAYER_MATCHES`, `MIN_HERO_PICKS`, `MIN_TEAMMATE_MATCHES`, `MIN_H2H_MATCHES`); they are env-configurable and currently lowered to `2` for the small early dataset, to be raised as history grows. The aggregator also publishes them in `stats.json` under `metadata.thresholds` so clients read the numbers instead of duplicating them.
- `matches.json` holds at most `MATCHES_LIMIT` (default 500) newest matches and carries per-player counts only — never chat text or raw log lines.
- `stats.heroes` also carries `radiant_picks`, `dire_picks`, and `contested` (the number of matches in which both sides picked that hero), so the Heroes section can summarise pick distribution and contested picks without loading any per-match data.
- `stats.recent_matches` carries a bounded newest-match teaser (`RECENT_MATCHES_LIMIT`, default 5) with per-side kill totals and the five hero ids each side fielded, so the dashboard can show recent lobbies — and the heroes that played them — without fetching the per-match payload.
- Behavior metrics are aggregated **counts only** (pings, chat-message counts, ward/order/rune counts); raw chat text is deliberately outside the product's data contract.
- Explicitly out of scope so far: advanced analytics (timelines, positions, combat logs), any database/API Gateway/DynamoDB/Athena, and authentication.
- All UI copy is English.

## Brand Commitments

- Product name presented to users: **"Dota 2 Lobby Stats"**.
- UI voice and copy are English (a deliberate choice, already migrated to English).
- The dashboard is authored and maintained as a personal project of the lobby group; there is no external brand, sponsor, or marketing voice to uphold.

## Evidence on Hand

- Real, working pipeline and deployment: Terraform-defined AWS infrastructure, a deployed S3 + CloudFront dashboard, and a live `stats.json` generated from actual replays.
- Real data contract: `aggregator/aggregator.py`, `web/src/types/stats.ts` (schema mirror), and `samples/parsed-example.json`.
- Sample/anonymized player names in docs (e.g. "Budi") are illustrative only.
- Absences future work must **not** fabricate: no testimonials, customer logos, user counts, press, benchmarks, or uptime/cost figures beyond what is actually measured; no public launch or audience claims; no commercial/pricing model.

## Product Principles

1. **The replay is the source of truth.** Statistics are derived, deterministic, and always reproducible by rebuilding from the original files.
2. **Stay serverless and near-zero cost.** No database and no always-on compute; the cheapest architecture that keeps the data correct wins.
3. **Identity is numeric.** `account_id` is the key; names are cosmetic labels that must never drive aggregation.
4. **Privacy by default.** Expose aggregate counts, never raw chat text.
5. **Correctness before features.** Skip and log bad input rather than let it corrupt historical stats; add analytics only when the foundation is trustworthy.
