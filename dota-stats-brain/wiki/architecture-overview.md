---
type: system
created: 2026-10-22
updated: 2026-10-22
sources:
  - ../docs/architecture.md
  - ../README.md
tags: [architecture, aws, system]
---

# Architecture overview

## Summary

The documented data path is replay upload to object storage, parser processing into normalized match JSON, aggregation across parsed matches, and publication of statistics for the web dashboard. The architecture uses AWS Lambda, S3, API Gateway, and a static frontend.

## Main components

- **Web dashboard:** React/Vite frontend reads published statistics and match data; deployed as static assets.
- **Upload API:** API Gateway HTTP API with a Lambda validates upload credentials, checks duplicates, and returns presigned S3 upload details.
- **Parser:** Container-image Lambda runs the bundled `odota/parser` Java parser via a CLI wrapper and writes normalized output.
- **Aggregator:** Python Lambda rebuilds statistics from parsed match objects and mirrors dashboard payloads to the dashboard bucket.
- **Storage:** S3 holds replay input, parsed match output, and dashboard artifacts.

These responsibilities are described in [architecture](../docs/architecture.md) and [README](../README.md); see [[replay-processing]] for processing detail.

## Flow

1. A user requests an upload from the dashboard.
2. The upload API validates the request and supplies a presigned upload.
3. The replay is stored in S3 and triggers parsing.
4. The parser produces normalized match data.
5. Aggregation rebuilds the statistics from valid parsed matches and publishes dashboard data.
6. The static frontend loads the published data.

## Caveats

This is a documentation-derived architecture, not a fresh inspection of deployed AWS resources. Confirm current Terraform and runtime code before relying on operational details.
