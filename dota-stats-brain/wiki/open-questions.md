---
type: synthesis
created: 2026-10-22
updated: 2026-10-22
sources:
  - ../dota_replay_mvp_plan.md
  - ../dota_replay_mvp2_plan.md
  - ../futureimprovement.txt
tags: [questions, roadmap]
---

# Open questions

Items below are prompts for deliberate verification, not claims that the project is deficient.

- Which ideas in the MVP plans and `futureimprovement.txt` are still desired, completed, or superseded?
- What is the authoritative current normalized match schema, including optional fields and parser-version assumptions?
- Does the aggregator rebuild all history on every parsed-match event, or has the implementation evolved?
- Which deployment environment and AWS resources are currently active? Repository configuration alone does not establish live state.
- Which dashboard datasets are generated, and what freshness guarantees are intended?

Resolve these by checking current code and asking the project owner where intent or live operational state is not recorded.
