# Replay-grounded AI match analysis

The optional analysis API reads one private-lobby `parsed/<id>.json` from the replay bucket. It exposes an allowlisted subset of replay fields, including purchase events, and excludes chat and Steam IDs. It never sends the replay file itself to OpenRouter. From schema 7, missing purchase timestamps are null; older schemas used zero for both unknown and valid timestamps, so those legacy purchase times are treated as unknown. Timeline events and snapshots can have a valid time of zero. Duplicate-hero purchase attribution can be ambiguous, and purchase events do not prove completion or use. The system has no patch-specific item reference or teamfight timeline; the model is instructed to state those limitations.

The match page displays a compact Match insight with an expandable review of the winning team, the losing team's challenges, and suggestions. Insights are cached in the replay bucket under `ai-cache/`, keyed by replay data, model and prompt version. The older item-analysis and standalone question API endpoints remain available, but are not shown in the match page. Missing parsed fields remain missing.

Parser schema 6 adds minute snapshots of team economy and damage, plus hero-death and building-destruction combat-log events. Reprocessing the replay is required to populate those fields; older files remain usable with a more limited analysis. Hero death event totals can differ from the scoreboard, building events can include non-towers, and the data does not itself identify teamfights or causality. The API includes these limitations and count comparison in the model context. Purchase events and patch-specific item advice remain subject to the limitations above.

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
