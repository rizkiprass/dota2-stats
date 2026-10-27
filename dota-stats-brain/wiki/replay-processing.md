---
type: system
created: 2026-10-22
updated: 2026-10-22
sources:
  - ../docs/architecture.md
  - ../README.md
  - ../parser/handler.py
  - ../parser/normalize.py
  - ../aggregator/aggregator.py
tags: [replay, parser, data]
---

# Replay processing

## Summary

The replay pipeline converts a `.dem` replay into parser events, normalizes those events into a match-oriented JSON representation, then aggregates parsed matches into dashboard statistics.

## Stages

1. **Input:** replay upload is stored in S3; the upload API's duplicate check and presigned upload flow are documented in [README](../README.md).
2. **Parsing:** the container Lambda invokes the bundled `odota/parser` Java code using `parser/java/FileParse.java`, rather than running the parser's normal HTTP server.
3. **Normalization:** Python code converts parser output to the project's normalized shape; inspect [normalizer](../parser/normalize.py) and [parser handler](../parser/handler.py) for current field-level behavior.
4. **Aggregation:** [aggregator](../aggregator/aggregator.py) rebuilds statistics from parsed match objects and publishes outputs as described in [architecture](../docs/architecture.md).

## Important distinction

The detailed field schema and edge-case rules should be derived from the current parser and normalizer implementation, not inferred from the high-level architecture. This page intentionally does not enumerate unverified fields.

## Related pages

- [[architecture-overview]]
- [[open-questions]]
