# Implementation Plan — AI Player Profile Analysis (Dota 2 Statistics)

> **Purpose:** Execution-ready plan for an AI coding agent to inspect the existing codebase, implement evidence-based AI Player Profile Analysis, test it, and deploy incrementally on the current low-cost AWS serverless platform.
>
> **Language:** Implementation guidance in Bahasa Indonesia; code identifiers, AWS service names, and common technical terminology remain in English.
>
> **Status:** Proposed plan. No repository, JSON sample, infrastructure configuration, or deployed resources have yet been inspected. **Do not treat assumptions as verified facts.**

## 0. Mission & non-negotiable constraints

Bangun AI Player Profile Analysis pada setiap Dota 2 player profile page dengan memanfaatkan JSON hasil parsing replay `.dem`. AI harus menjelaskan performa berdasarkan data terukur: strengths, weaknesses, trends, dan actionable coaching recommendations. Hasil ditampilkan dari **persisted/cached analysis**, bukan memanggil LLM pada setiap page view.

**Existing AWS services confirmed by owner:** AWS Lambda, Amazon DynamoDB, Amazon S3, Amazon API Gateway, Amazon CloudFront.

**Design principles:**

1. **Preserve the existing application**: reuse deployed AWS services, established frontend/backend conventions, IaC, authentication, and data model whenever feasible. Do not perform a database migration by default.
2. **Serverless and low cost**: no new EC2, always-on ECS/Fargate, RDS/Aurora, OpenSearch, NAT Gateway, ElastiCache, or Bedrock Knowledge Base in MVP.
3. **Deterministic analytics first**: calculate performance metrics with code; LLM interprets precomputed evidence only. No imaginary performance scores, reference ranges, or match events.
4. **Event-driven, idempotent, and asynchronous**: aggregate and AI generation run after new eligible match data is committed; do not block replay ingestion or the player profile endpoint.
5. **Security by default**: least-privilege IAM, encrypted storage, no keys in source control/logs/frontend, no secrets passed through client requests, sanitized model outputs.
6. **Progressive delivery**: build behind feature flags; production deployments and cloud resource changes require user approval unless explicit authorization already exists in the agent environment.
7. **Optimize LLM cost**: configurable model, per-player cooldown, change detection, token caps, concurrency controls, and budget monitoring.
8. **Evidence and provenance**: each generated conclusion maps to numeric metrics, match sample, or a verified replay-derived event. Use `insufficient_data` rather than unsupported claims.

## 1. Mandatory first task: repository & infrastructure discovery

**Do not start by installing LangChain, LangGraph, or creating AWS resources.** Inspect current implementation first.

### 1.1 Repository reconnaissance

- [ ] Identify monorepo/workspaces, frontend framework, backend runtime, package manager, coding standards, test runner, and deployment pipelines.
- [ ] Locate player profile routes/components, current statistics endpoints, player identifiers, and authentication/authorization patterns.
- [ ] Trace `.dem` upload -> parser -> JSON output -> S3 keys -> DynamoDB writes -> profile reads, including failure handling.
- [ ] Inspect 1-3 representative **redacted** replay JSON files (small/large match and different heroes/roles if available); document top-level structure, type variability, timestamps, player mapping, missing fields, and event logs.
- [ ] Inspect DynamoDB table(s), key schema, GSIs, current access patterns, TTL policies, and existing item shapes. Validate any 400 KB DynamoDB item risk.
- [ ] Inspect AWS Lambda runtimes, layers, dependency packaging, concurrency, timeouts, S3 events, API Gateway routes, CloudFront caching, CloudWatch alarms, and existing IaC (CDK/SAM/Terraform/Serverless Framework/etc.).
- [ ] Determine whether analytics data is already aggregated; reuse existing metrics rather than recomputing in duplicate pipelines.
- [ ] Check existing account/Steam ID mapping, match uniqueness, duplicate uploads, match eligibility, and replay parser versions.
- [ ] Check whether a compatible secrets manager, configuration approach, and LLM observability solution already exist.

### 1.2 Discovery deliverables

Create `docs/ai-player-analysis/discovery.md` with:

- Verified architecture diagram or concise current data-flow description.
- Repo paths and actual source code entrypoints for replay parsing, DynamoDB writes, profile API and profile UI.
- Real replay JSON field inventory with sample values/types (redact personal identifiers and credentials).
- Metrics feasibility matrix: **available directly**, **derivable**, **unavailable**.
- Current DynamoDB key patterns and recommended **minimal-change** storage design.
- A list of unknowns, blockers, and decisions. Prefer safe defaults for non-critical unknowns; request explicit owner input only for genuinely blocking dependencies.

**Discovery gate:** No schema mutation, new infra, or LLM generation until the data shape and write path are understood.

## 2. MVP scope and out of scope

### In scope

- A single player-level analysis for a configurable recent window (default: **last 20 eligible matches**, falling back to a smaller sample with clear sample-size warning).
- Numeric metrics and trends calculated only from present, trustworthy fields.
- Role-aware interpretation where role confidence is sufficient; otherwise mark role as unknown and avoid role-specific grading.
- Structured output: overall summary, strengths, weaknesses, improvement recommendations, supporting evidence, warnings, status, and timestamp.
- Async generation, storage, cache invalidation, failures/retries, observability, and frontend presentation.
- Backfill for existing players with bounded batch size and a dry-run mode.

### Explicitly out of scope for MVP

- Real-time, token-streaming AI chatbot.
- Multi-agent framework / LangGraph workflows.
- RAG, vector database, semantic search, live patch-guide retrieval.
- Unverified percentile rankings or MMR/skill predictions.
- Automatically generating coaching claims about wards, vision, pathing, map awareness, objective conversion, or positioning without sufficient replay-derived event data and agreed metric definitions.
- Model fine-tuning, autonomous changes to production infra, always-on workers.

## 3. Preferred architecture (adapt to verified codebase)

```text
Existing replay ingest (.dem -> JSON)
                 |
                 v
           Amazon S3 (raw JSON)
                 |
                 v
      Existing validated ingest path
                 |
         eligible match committed
                 |
                 v
   [optional] SQS ingestion/aggregation queue
                 |
                 v
      Lambda: metrics aggregation
      - dedup + player match resolution
      - compute per-match metrics
      - calculate recent-window metrics
      - persist metric version / source hash
                 |
                 v
         DynamoDB (player metrics)
                 |
        enqueue only if changed / due
                 |
                 v
           Amazon SQS + DLQ
                 |
                 v
      Lambda: AI analysis worker
      - fetch compact aggregates + benchmarks
      - construct guarded prompt
      - invoke OpenRouter or selected model
      - Pydantic validate & evidence check
      - conditional write + state transition
                 |
                 v
         DynamoDB (AI analysis)
                 |
                 v
Existing API Gateway + Lambda -> Player Page via CloudFront
```

**Critical detail:** Trigger from an **authoritative, committed/validated match** point, not blindly from S3 `ObjectCreated` if the existing pipeline has additional parser/enrichment stages. S3 notifications may be duplicated/out of order; never assume exactly-once delivery. If existing ingestion already has a reliable event/worker, extend it instead of adding an unnecessary queue.

### Service mapping

| Requirement | MVP choice | Notes |
|---|---|---|
| Raw replay JSON | Existing S3 | Retain original for audit and deterministic rebuilds |
| Computation | Existing/new Python Lambda | Use standard library or lightweight deps; Polars only if justified by profiling |
| Metrics + AI result store | Existing DynamoDB if key design permits | Separate table only if access pattern or permissions require it |
| Async jobs | SQS standard queue + DLQ, or existing queue | Use job deduplication/conditional writes at application level |
| LLM API | OpenRouter via HTTPS | Bedrock as interchangeable future provider; no requirement to migrate |
| LLM integration | Direct API client + Pydantic | LangChain optional if it lowers code complexity; LangGraph not needed |
| Secrets | Existing secrets solution, preferably Secrets Manager/SSM SecureString | Assess per-request secret retrieval cost; cache in warm Lambda safely |
| Monitoring | CloudWatch logs/metrics/alarms | Langfuse Cloud optional; no self-hosting for MVP |
| Delivery | Existing API Gateway + Lambda + CloudFront | Reuse auth, authorization and caching conventions |

**Networking:** For public OpenRouter access, prefer Lambda **not attached to a customer VPC** unless verified dependencies require it; this avoids NAT Gateway costs. If VPC is required, explicitly design outbound connectivity and quantify cost before deployment.

## 4. Data contracts and deterministic analytics

### 4.1 Player/match identity & eligibility

- Define a canonical `player_id` (verify Steam ID/account ID rules and anonymous players).
- Define unique `match_id` plus replay revision/source hash; reject/ignore duplicate logical matches.
- Define match eligibility: parsed successfully, player reliably matched, enough fields present; identify remakes, abandoned or incomplete matches where possible.
- Sort by match timestamp for the recent window; make timestamp/timezone conversion explicit.
- Version metric formulas and replay parser mappings so old analysis can be invalidated intentionally.

### 4.2 Metrics feasibility matrix — fill with verified fields

| Metric | Candidate formula / rule | Prerequisite | Safety rule |
|---|---|---|---|
| Win rate | wins / eligible matches | player win/loss outcome | disclose N |
| KDA ratio | (kills + assists) / max(1, deaths) | K/D/A | define zero-death policy |
| Avg GPM/XPM | mean per-match GPM/XPM | GPM/XPM values | null when absent |
| Last hits @ 10m | last-hit timeline count by 600s | time-series event | don't infer from final last hits |
| Kill participation | (kills + assists) / team kills | team kills | handle zero team kills |
| Hero damage | mean hero damage | damage fields | normalize by match duration if comparing |
| Tower/building damage | sum/mean | structure damage fields | distinguish raw damage from objective conversion |
| Item timings | item purchase timestamps | purchase events | use hero/role/patch context if scoring |
| Death timing | distribution by game phase | timestamps of deaths | phase boundaries configurable |
| Vision/map metrics | ward events + positions / vision state | detailed replay events | **do not generate** without evidence |
| Objective conversion | agreed explicit definition | objective/teamfight timeline | keep unavailable until defined |

Do **not** treat these candidate fields as guaranteed present in the user's JSON. Where impossible, return a structured unavailable reason rather than synthesizing data.

### 4.3 Benchmarking and scoring

- Begin with fact-based narrative and within-player trends. Do not fabricate a universal 0–100 performance score.
- Only add percentile/score if the benchmark dataset and version are real, sufficiently sampled, and segmented by **role, patch, game duration, and where appropriate hero and skill bracket**.
- A support player cannot be penalized for carry farming baselines.
- If inferred role has low confidence, use neutral language and request stronger data later.
- Preserve formula version, dataset sample size, and segment metadata in benchmark records.

### 4.4 Example compact metrics payload (illustrative; NOT an actual schema)

```json
{
  "schema_version": "1.0",
  "player_id": "example-player",
  "window": {"type": "recent_matches", "requested": 20, "eligible": 18},
  "source": {"match_ids": ["m1", "m2"], "source_hash": "sha256:..."},
  "role": {"value": "carry", "confidence": 0.91},
  "metrics": {
    "win_rate": {"value": 0.61, "unit": "ratio", "sample_size": 18},
    "avg_gpm": {"value": 638, "unit": "gold_per_minute", "sample_size": 18},
    "avg_kda_ratio": {"value": 3.4, "unit": "ratio", "sample_size": 18}
  },
  "unavailable_metrics": ["vision_deaths", "objective_conversion_rate"],
  "metrics_version": "1.0.0"
}
```

Use **canonical JSON serialization** (stable key order and numeric precision) to calculate `source_hash`; hash only the actual analytical inputs, not incidental upload metadata. Keep large match ID lists outside a single item if size approaches DynamoDB limits.

## 5. Storage & access patterns

**Do not create a separate DynamoDB table until the existing keys/GSIs are inspected.** One possible pattern (example only):

- `PK=PLAYER#<id>`, `SK=STATS#RECENT_20#v1`: compact computed aggregate.
- `PK=PLAYER#<id>`, `SK=AI#RECENT_20#v1`: latest published AI analysis.
- `PK=PLAYER#<id>`, `SK=AIJOB#<window>#<source_hash>`: generation state/dedup (or a standalone job table if necessary).

Recommended AI fields:

```text
schema_version, player_id, window, source_hash, metrics_version,
model_provider, model_id, prompt_version, analysis_version,
status (PENDING | RUNNING | COMPLETED | FAILED | INSUFFICIENT_DATA),
summary, strengths[], weaknesses[], recommendations[],
evidence[], limitations[], matches_analyzed,
generated_at, updated_at, expires_at(optional), error_code(optional)
```

- Avoid exceeding DynamoDB's 400 KB item limit; keep detailed per-event evidence in S3 if needed.
- Atomic conditional writes / optimistic concurrency must prevent old job results overwriting fresher analyses.
- Use stale-while-revalidate: serve completed prior analysis while an update is pending, with `stale` + `generated_at` metadata.
- Consistency: do not mix match windows, metrics versions, or model outputs under the same cache key.
- CloudFront/API Gateway: review existing caching policy; avoid cross-player cache leakage; use explicit cache keys and appropriate authorization rules.

## 6. AI generation design

### 6.1 Provider abstraction

Implement a thin `LLMProvider` interface with `generate_structured_analysis(payload, model_config)`. Start with OpenRouter; optionally add Bedrock later behind the same interface. Model name, token limits, temperature, timeout, and price assumptions must be configurable (environment/IaC config). Verify actual model availability and structured-output support rather than hard-coding an unverified model.

### 6.2 Prompt & structured output

- System instruction: act as a Dota performance analyst; interpret only supplied metrics and validated benchmarks, no invented data or claims.
- Input includes: compact aggregates, role confidence, temporal trends, metric definitions, available match references, known limitations, patch/hero context **only when present**.
- Output in strict JSON validated by Pydantic (or equivalent runtime validator).
- Every material insight has `metric_keys` and preferably `match_ids` as evidence references.
- Require actionable recommendations with measurable next steps; do not include generic praise unsupported by data.
- Distinguish `fact`, `inference`, and `limitation`, ideally in model schema; don't use a probabilistic "confidence" score as calibrated certainty without validation.
- Player display names, match chat, and replay-derived free text are **untrusted inputs**; prevent prompt injection by keeping them outside instructions and removing/limiting irrelevant text.
- On model failure, return `FAILED` with bounded retry; optionally show deterministic statistics-only fallback, clearly labeled non-AI.

### 6.3 Example output contract (illustrative)

```json
{
  "schema_version": "1.0",
  "summary": "The player shows ...",
  "strengths": [{
    "title": "Consistent farming",
    "explanation": "...",
    "metric_keys": ["avg_gpm"],
    "match_ids": [],
    "kind": "inference"
  }],
  "weaknesses": [],
  "recommendations": [{
    "action": "Review farm-to-fight transition timing",
    "reason": "...",
    "metric_keys": ["avg_gpm", "kill_participation"]
  }],
  "limitations": ["Vision metrics are unavailable in this replay data."],
  "matches_analyzed": 18
}
```

Build deterministic **post-generation validation**: referenced metrics must exist and be non-null; referenced match IDs must be within the analyzed window; no unsupported scores or incompatible role benchmarks; enforce character/item limits. If validation fails, retry at most a small configured number of times, then mark failed and inspect trace.

### 6.4 When to regenerate

- Initial run only after minimum eligible matches are available (configurable default: 10; if fewer, show `INSUFFICIENT_DATA` or short factual summary rather than pretending high confidence).
- For eligible profiles, refresh on changed aggregate `source_hash`, subject to a configurable cooldown (suggested starting policy: no more than once per player per 24 hours).
- Never run LLM from the profile GET request.
- Expose a refresh state in API; optional on-demand refresh endpoint must be authenticated, rate-limited, and guarded against repeated charges.
- Use `prompt_version`, `metrics_version`, `analysis_version`, and `model_id` for explicit invalidation.

## 7. SQS/Lambda reliability

- SQS standard queue with DLQ, redrive policy, alarm on DLQ depth and oldest message age.
- Lambda event source mapping: start with batch size 1 to simplify debugging, then optimize.
- Configure visibility timeout based on actual worker timeout and batch window, following AWS's current guidance (commonly >= 6× Lambda timeout).
- Include source hash and player ID in message; ensure no secrets or massive raw JSON in SQS.
- Ensure idempotency via conditional DynamoDB state transition and (if appropriate) a lease with expiry to recover crashed jobs.
- Handle duplicated, reordered and delayed events; ensure older completed jobs cannot overwrite current aggregate.
- Implement capped exponential backoff for transient LLM/rate-limit errors; permanently invalid payloads should not be endlessly retried.
- Configure reserved/max concurrency to enforce LLM budget and provider rate limits; explicitly handle worker timeout (Lambda max 15 min).
- Track job states and alert when jobs remain stuck in RUNNING beyond lease TTL.

## 8. API & frontend integration

Inspect current contracts first. Proposed compatible API options:

```http
GET /players/{player_id}/ai-analysis
```

Response conventions (adapt to current API):

- `COMPLETED`: analysis, supported evidence, generated timestamp, sample size, source version.
- `PENDING` / `RUNNING`: clear status + optional last completed analysis marked stale.
- `INSUFFICIENT_DATA`: explain minimum sample requirement.
- `FAILED`: non-sensitive error status and deterministic fallback.
- `NOT_FOUND`: profile not found or never analyzed, as appropriate.

Frontend should:

- Reuse existing player profile layout and UI components.
- Show **AI Analysis** card: summary, strengths, weaknesses, recommendations, source window, last updated, caveats.
- Distinguish verified statistics from AI interpretation; link each insight to the underlying metric/matches where possible.
- Support loading, empty, stale, failed, and insufficient-data states.
- Avoid loading spinners that never finish; no synchronous inference during page rendering.
- Sanitize/escape LLM text when rendering. Never render model-produced arbitrary HTML.
- Respect any authentication rules or player-level visibility restrictions already present.

## 9. Observability, safety, and cost control

**CloudWatch metrics/logs:** `AIAnalysisQueued`, `AIAnalysisSucceeded`, `AIAnalysisFailed`, `AIAnalysisSkippedUnchanged`, `AIAnalysisDurationMs`, `LLMInputTokens`, `LLMOutputTokens`, `EstimatedLLMCostUSD`, queue depth/age, DLQ depth, throttles, cache hit rate.

- Use correlation IDs (`player_id` hashed/redacted as appropriate, job ID, source hash prefix), never log credentials/raw entire replay/chat.
- Add CloudWatch alarms for repeated errors, DLQ backlog, latency, and daily/monthly spend anomalies; optionally AWS Budgets for AWS resources.
- Log provider latency, HTTP status, model ID, and tokens used (if exposed). Treat external OpenRouter spend separately from AWS Billing / Budgets; enforce provider spending caps if available.
- Langfuse Cloud optional for prompt versioning, evaluation, cost/traces. Never create always-on self-hosted Langfuse for MVP.
- Retain trace and player data for a documented period; avoid sending player-sensitive metadata to a third-party provider unnecessarily.
- Provider API key stored server-side only. Verify log redaction and outbound network access.

**Cost guardrails:**

1. `max_new_analyses_per_day` global limit and configurable per-player cooldown.
2. Token limits and compact payload, no raw replay JSON in LLM request.
3. Cache/invalidate via source hash; skip unchanged player windows.
4. Concurrency cap and queue-based load shedding.
5. Dry-run cost estimator using representative payload token counts and *current verified* model price.
6. Alert on LLM spend threshold and define a manual kill switch (`AI_ANALYSIS_ENABLED=false`).

Illustrative cost formula (not an actual quote):

```text
LLM_cost_usd =
  analyses * ((avg_input_tokens * input_usd_per_1M_tokens) +
              (avg_output_tokens * output_usd_per_1M_tokens)) / 1_000_000
```

Also consider Lambda duration/memory, DynamoDB read/write volume, SQS requests, CloudWatch ingestion, Secrets Manager requests, and internet egress; do not assume all charges are zero under Free Tier.

## 10. Implementation work packages (execute sequentially)

### WP0 — Discovery & baseline (P0)

- [ ] Complete Section 1 and create `docs/ai-player-analysis/discovery.md`.
- [ ] Identify 3–5 representative JSON fixtures with redacted source data.
- [ ] Record current deployment procedure and baseline cost/performance before modifications.
- [ ] Produce an exact file change list and Infrastructure-as-Code change plan.

**Acceptance:** Metrics feasibility and real existing access patterns documented; unknowns visible; no infra changed.

### WP1 — Analytics contracts & deterministic metrics (P0)

- [ ] Define versioned input/output schemas, supported metric formulas, sample window, null handling, role confidence.
- [ ] Implement pure functions for replay-field mapping, per-match metric extraction, player aggregation, stable source hash.
- [ ] Add unit tests for duplicate matches, zero deaths, missing metrics, insufficient sample size, multiple heroes/roles, inconsistent timestamps, abandoned matches.
- [ ] Persist compact metrics using existing database conventions.

**Acceptance:** Same fixture yields deterministic aggregate; missing values never silently become 0; all computed metrics trace to replay fields.

### WP2 — Async orchestration & persistence (P0)

- [ ] Choose event trigger based on verified committed-match point.
- [ ] Implement queue/trigger and idempotent job state transitions; use existing queue if already suitable.
- [ ] Implement source-hash invalidation, cooldown, latest-result protection, bounded backfill.
- [ ] IaC for least-privilege access, queue/DLQ, concurrency, logs and alarms (where necessary).

**Acceptance:** Duplicate events generate no duplicate paid analyses; stale workers never overwrite newer results; failed jobs retry safely.

### WP3 — AI worker (P0)

- [ ] Build provider abstraction, OpenRouter client/config, server-side secret loading, strict timeout.
- [ ] Design versioned guarded prompt; request structured JSON only.
- [ ] Implement Pydantic schema, evidence validation, output sanitation, error taxonomy, bounded retry.
- [ ] Write analysis atomically with model/prompt/metrics versions, source hash, timestamp, evidence, limitations.
- [ ] Add fake provider for local tests; optional Langfuse if already available or approved.

**Acceptance:** Model cannot reference nonexistent metrics in persisted final output; no frontend secrets or unbounded retry; inference cost measurable.

### WP4 — API + UI player page (P0)

- [ ] Reuse existing profile route/API design to fetch current/cached analysis.
- [ ] Implement component with clear summary, strengths, weaknesses, recommendations, provenance, last update.
- [ ] Implement status UI: loading, pending, insufficient data, error, stale, completed.
- [ ] Add feature flag and user-facing fallback when AI provider is unavailable.

**Acceptance:** Profile page renders even if LLM is down; repeated page refreshes do not trigger inference; UI content backed by saved analysis.

### WP5 — Quality evaluation (P1 before full release)

- [ ] Build a gold evaluation set across roles (carry/mid/offlane/support), winners/losers, sample sizes, and sparse-data conditions.
- [ ] Implement programmatic validation: JSON schema pass rate, evidence-reference correctness, unsupported-claim rate, latency and token cost.
- [ ] Add human review for gameplay usefulness and role fairness; measure disagreement and refine metrics/prompt.
- [ ] Optional LLM-as-judge (Langfuse) only as supplementary signal, not the sole correctness authority.

**Acceptance:** 100% of published outputs pass deterministic schema/evidence checks; no high-severity unsupported gameplay claims in approved evaluation set; remaining targets documented and approved.

### WP6 — Gradual deployment & operations (P1)

- [ ] Run local tests and integration tests against non-production resources/mocks.
- [ ] Run `terraform plan`, `cdk diff`, or equivalent existing IaC diff and submit for review.
- [ ] Deploy behind disabled/limited feature flag, then enable for a small allowlisted cohort.
- [ ] Backfill incrementally with low concurrency and spend cap, monitor Lambda/SQS/DynamoDB/provider usage.
- [ ] Provide deployment runbook, rollback instructions, dashboard and cost report.

**Acceptance:** Current replay ingestion unaffected; all alerts in place; small-cohort metrics validate before wider rollout.

## 11. Test matrix

| Scenario | Expected result |
|---|---|
| Replay has all required fields | Valid aggregate, AI insights with metric references |
| Replay missing timeline events | Unsupported timeline metrics unavailable; no invented map/vision conclusions |
| Same S3/match event delivered twice | No double aggregation or duplicate LLM charge |
| Older AI job completes last | Newer result retained via conditional write |
| OpenRouter 429/5xx or network timeout | Bounded retry, backoff, eventual DLQ/failure status |
| Invalid JSON / model adds unsupported stat | Rejected by schema/evidence checks, not published |
| Fewer than minimum eligible matches | `INSUFFICIENT_DATA` with clear explanation |
| Player changes role or hero mix | Safe role-specific handling or neutral analysis |
| Frontend repeated page reloads | No LLM calls; cached DynamoDB result used |
| Burst of match imports | Queue buffers work; concurrency/cost cap holds |
| AI worker disabled | Core player profile continues operating |
| Unauthorized user or malformed player ID | Existing authorization/input validation preserved |

## 12. Required final agent deliverables

After implementation, provide:

1. `docs/ai-player-analysis/discovery.md` — what was verified in code and infrastructure.
2. `docs/ai-player-analysis/architecture.md` — actual updated data flow, contracts, IAM, and API.
3. `docs/ai-player-analysis/metrics.md` — formulas, source JSON fields, missing-data treatment, role/patch benchmark rules.
4. `docs/ai-player-analysis/operations.md` — deployment, backfill, alarms, cost caps, disable/rollback and troubleshooting.
5. Source code + tests + IaC changes in the existing repository conventions.
6. Example **redacted** AI analysis output tied to real parsed replay fields.
7. Test results, open risks, estimated incremental monthly costs with pricing assumptions, and list of AWS resources actually added/modified.

## 13. Stop conditions & escalation

Pause changes (but continue read-only investigation/documentation) if:

- JSON is missing fundamental player/match identity or reliable performance metrics.
- Existing DynamoDB layout or API authorization rules cannot be understood safely.
- Changes would disrupt production ingestion or require destructive table/index migrations.
- LLM costs cannot be capped, key management is unresolved, or Lambda cannot reach provider without unapproved NAT costs.
- Agent is asked to apply production infrastructure updates without permission or approved change process.

When blocked, report: **verified facts → blocker → alternatives → recommended minimal next step**. Do not invent schema fields or production credentials.

## 14. Immediate next action for the coding agent

**Start with WP0.** Inspect the repository and existing deployed architecture read-only; report the actual JSON replay schema, DynamoDB keys, profile endpoint/UI paths, and which metrics can be derived. Then propose minimal code/IaC changes consistent with this plan. Do not install an agent framework or provision AWS services unless a verified technical requirement justifies it.
