---
type: synthesis
created: 2026-10-22
updated: 2026-10-22
sources:
  - ../PRODUCT.md
  - ../README.md
  - ../DESIGN.md
tags: [project, overview]
---

# Project overview

## Summary

This project turns Dota 2 replay files into normalized match data, aggregate statistics, and a web dashboard for exploring player and lobby performance. Its documented MVP includes replay parsing, historical aggregation, dashboard views, and leaderboard category detail pages.

## Product shape

- Replays are uploaded for parsing; parsed match data feeds aggregate statistics.
- The dashboard presents summaries, match history/details, hero views, records, behavior, and leaderboards. See [product scope](../PRODUCT.md) and [README](../README.md).
- The project is implemented as a static web frontend plus AWS-backed ingestion and data processing components. See [[architecture-overview]].

## Evidence boundary

This summary describes repository documentation, not a live production health check. Deployment state, current user adoption, and whether every planned feature remains current have not been verified.

## Related pages

- [[architecture-overview]]
- [[replay-processing]]
- [[open-questions]]
