# Replay-grounded AI match analysis

The optional analysis API reads one private-lobby `parsed/<id>.json` from the replay bucket. It exposes an allowlisted subset of replay fields, including purchase events, and excludes chat and Steam IDs. It never sends the replay file itself to OpenRouter. From schema 7, missing purchase timestamps are null; older schemas used zero for both unknown and valid timestamps, so those legacy purchase times are treated as unknown. Timeline events and snapshots can have a valid time of zero. Duplicate-hero purchase attribution can be ambiguous, and purchase events do not prove completion or use. The system has no patch-specific item reference or teamfight timeline; the model is instructed to state those limitations.

The insight prompt includes a deterministic `facts` block computed in Python from the parsed match: per-team totals (kills, deaths, assists, last hits, denies, hero/tower damage, net worth, gold, XP, stuns) and exact objective counts (`towers_killed`, `roshans_killed`), plus per-team leaders and a `data_availability` map. The model must quote these values instead of adding scoreboard fields itself, so a whole-match total is never attributed to one team, and it must report a signal as unavailable when the map marks it missing. A field is omitted from the totals when any member lacks it, so a partial team sum is never published. An insight that fails schema validation is retried once before the request fails, and a malformed reply is never cached; the failure log records only the returned top-level key names, never the answer text. When the optional Langfuse evaluator is enabled, each uncached insight also carries a judge reference that embeds the same `facts` (including the exact `towers_killed`/`roshans_killed`) and per-player role/lane, so the judge can verify objective and role claims instead of marking supported statements as unsupported.

The match page displays a compact Match insight with an expandable review of the winning team, the losing team's challenges, and suggestions. Insights are cached in the replay bucket under `ai-cache/`, keyed by replay data, model and prompt version. The older item-analysis and standalone question API endpoints remain available, but are not shown in the match page. Missing parsed fields remain missing.

The insight-specific prompt asks for an explanation of the observed evidence and actionable, conditional suggestions rather than isolated statistics. It distinguishes full-match totals from timestamped evidence and does not treat a correlation as proof of a cause or invent teamfight details. The existing JSON sections and 500-character item limit remain in place. Prompt version changes invalidate the insight cache, so the updated review is generated on the next request.

Parser schema 6 adds minute snapshots of team economy and damage, plus hero-death and building-destruction combat-log events. Reprocessing the replay is required to populate those fields; older files remain usable with a more limited analysis. Hero death event totals can differ from the scoreboard, building events can include non-towers, and the data does not itself identify teamfights or causality. The API includes these limitations and count comparison in the model context. Purchase events and patch-specific item advice remain subject to the limitations above.

The AI context only forwards building events with recognizable tower targets: combat-log building kills can also include units such as Underlord portals. A tower event identifies a destroyed tower and time, not its killer or the state of other structures. Other building events remain in the parsed replay but are not used as AI evidence.

## Local development

1. Obtain a private-lobby parsed JSON fixture from your replay bucket. Do not commit personal replay data.
2. Set `OPENROUTER_API_KEY` in your shell, with a dedicated OpenRouter key capped at **$1 monthly**. Never put the key in a `VITE_` variable or commit it.
3. Run `python3 ai/local_server.py /path/to/parsed-match.json` from the repository root. The locally verified schema-6 fixture for match 9077460624 is `/tmp/opencode/parsed-9077460624-v6.json` when generated on this machine.
4. Run `VITE_AI_API_URL=http://localhost:8787 npm run dev` from `web/` and open that match. The local server binds to loopback and keeps its analysis cache only in memory.

The local server uses only Python's standard library. `python3 -m unittest ai.test_handler` runs backend tests with mocks and does not call OpenRouter. The existing frontend build and Playwright suite provide further verification.

## Deployment prerequisites

Deployment is disabled by default. First create a dedicated OpenRouter key with a **$1 monthly key limit** in OpenRouter, and store it in an existing SSM SecureString. Set `ai_enabled = true` and `openrouter_key_parameter_arn` to that parameter's ARN, review the Terraform plan, then deploy only after approval. The parameter should use the AWS-managed SSM key, or the Lambda role must also be granted decrypt permission for the chosen customer-managed KMS key.

Build the frontend with `VITE_AI_API_URL` set to Terraform's `ai_api_url` output; for GitHub Actions set the production environment variable of the same name. The API is publicly accessible and has API Gateway throttling and a DynamoDB-backed limit of 10 uncached AI calls per IP per hour. The Lambda shares the account's unreserved concurrency. This is an approximate fairness limit, not a monthly spending cap; the OpenRouter key limit is the spending control. Cached item analyses do not use the AI-call limit. DynamoDB TTL removes expired rate records asynchronously. S3, DynamoDB, Lambda, API Gateway and other AWS charges are separate from OpenRouter.

The API does not publish or serve a general parsed-data browser. It checks the numeric match ID and requires lobby type 1. The API key is retrieved on the server; never provide it to the browser. AI answers can be wrong, and item advice is not a patch-specific guide.

## Optional Langfuse monitoring

Langfuse is disabled by default. Create a Langfuse Cloud project and API keys, and store its secret key in an existing SSM SecureString in the Lambda's region. Use the AWS-managed SSM key or grant the Lambda role permission to decrypt the customer-managed KMS key. The public key is configuration; never put the secret key in Terraform variables, frontend variables, or source control.

Before each deployment that changes the pinned SDK version, build the Python 3.13 x86-64 Lambda layer on a machine with Python, pip, and zip:

```sh
bash ai/build_langfuse_layer.sh
```

Set `langfuse_enabled = true`, `langfuse_public_key` and `langfuse_secret_key_parameter_arn` along with the existing AI settings, and review the Terraform plan. Set `langfuse_base_url` to the URL for your Langfuse Cloud region (the default is `https://cloud.langfuse.com`). The build artifact must be available to Terraform when planning and applying. When disabled, no layer or Langfuse credentials are required.

Each analysis, insight or chat POST gets a trace containing the match ID, action, prompt version, HTTP status and cache status when available. The root input/output contain only match ID, action, status and cache status. Cache misses have a child generation with the model, duration, token counts and OpenRouter cost when provided; cache hits do not call the model. Generation input/output contain only the prompt version, output-token limit and response status. Errors record a sanitized type or status. Prompts, questions, replay data, and API keys are not sent to Langfuse. Match IDs are sent as metadata. The deployed Lambda marks traces as `production`. Langfuse availability does not intentionally block analysis, but flushing adds latency; the Lambda timeout is extended to 45 seconds when enabled. Langfuse and AWS usage may incur additional charges.

Set `langfuse_capture_insight_output = true` (the default) to include the validated insight in the trace output, for both cache misses and cache hits. This is the only way to review answer content in Langfuse, but the insight can contain player names, hero picks, purchases and match statistics. Set it to `false` to keep traces free of answer content. The raw model response, chat questions, and replay data are never sent.

For a local Lambda-style test, install `ai/requirements-langfuse.txt` and set `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, and optionally `LANGFUSE_BASE_URL` in the shell. The standalone `ai/local_server.py` does not create request traces. After deploying, request an uncached insight and confirm its generation and usage in Langfuse, then repeat it to verify a cache-hit trace without a generation. Do not use actual keys in tests or logs.
