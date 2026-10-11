# AI Frontend Setup (OpenCode Agents & Skills)

How the project's OpenCode agents and skill are wired, why each choice was made,
and how to use or change them. All agent prompts and dashboard UI copy are in
English.

## Files

```text
.opencode/
├── agents/
│   ├── frontend.md         # builds and refines the dashboard UI
│   ├── visual-reviewer.md  # read-only critique of screenshots (subagent)
│   └── quick-edit.md       # fast, cheap mechanical tweaks
└── skills/
    └── design-system/
        └── SKILL.md        # tokens + conventions, shared by the agents
```

OpenCode discovers these automatically from the project's `.opencode/` directory.
No `opencode.jsonc` entry is required.

The UI verification tooling lives with the frontend: `web/playwright.config.ts`,
`web/tests/dashboard.spec.ts`, and `scripts/fetch-stats.sh`.

## Why models were chosen this way

All models come from the `opencode-go` provider. Two facts drove the choices:

1. **Screenshot review requires image input.** Not every model accepts images.
   In `opencode-go`, vision-capable models include `gpt-6-luna`, `grok-4.7`,
   `kimi-k3`, `qwen3.8-max`, `deepseek-v4.1-flash`, and `space-bunny-free`.
   Text-only models such as `deepseek-v4-pro`, `glm-5.3`, and `hy4-preview`
   cannot see a screenshot.
2. **A `#variant` tunes reasoning effort**, so one model can serve cheap and
   expensive work without switching models.

| Agent | Model | Why |
|---|---|---|
| `frontend` | `opencode-go/gpt-6-luna#medium` | Vision-capable and inexpensive (~0.1/0.5 USD per 1M tokens), so design passes stay affordable. `#medium` keeps routine build work cheap. |
| `visual-reviewer` | `opencode-go/deepseek-v4.1-flash#low` | Must see screenshots; vision-capable and the cheapest option for a read-only critique pass. |
| `quick-edit` | `opencode-go/deepseek-v4.1-flash#low` | Cheapest, fastest option for mechanical edits; `#low` avoids spending reasoning on trivia. |

Upgrade path for a hard design pass: switch `frontend` to `qwen3.8-max#xhigh`
or `kimi-k3#max` (pricier), or use `space-bunny-free` to explore for free.

## Roles and how they are separated

### `frontend` (primary or subagent)

The builder. Its permissions allow:

- `edit` on `web/**`
- `shell` for `npm run *`, `npm install*`, `npx tsc*`, `npx playwright*`,
  `node --check*`, `python3 -m http.server*`, `bash scripts/*`, and `google-chrome*`

Everything else stays permission-controlled, so it cannot wander outside `web/`.
Its system prompt enforces the project's frontend rules: React + TypeScript +
Tailwind, tokens from `web/src/styles.css`, no new runtime dependencies without
asking, run `npm run typecheck` / `npm run build`, small reviewable changes.

Its definition of done is local-first: build, refresh the `stats.json` fixture,
run the Playwright UI suite (`npm run test:ui`), get a clean `visual-reviewer`
pass, and only then deploy with `deploy-web.sh --wait`. This keeps unfinished
work off the public live site.

### `visual-reviewer` (subagent, read-only)

The critic. Permissions `deny` all edits and all shell access, so it can only
read and report. Making it a `subagent` matters for two reasons:

- It runs in its own child session, so a long critique does not pollute the main
  conversation's context.
- It is asked to rank findings by severity and end with the single most
  impactful change, which keeps output actionable.

The review checklist (hierarchy → spacing → contrast → consistency →
responsiveness) lives in the agent file, so it is consistent every run.

### `quick-edit` (primary or subagent)

For small, well-specified work: labels, minor CSS values, renames, typos. It is
told to hand back to `frontend` when a request needs design judgement or spans
multiple files.

## Shared knowledge: the `design-system` skill

The agents do not duplicate design decisions. Instead each agent loads the
`design-system` skill, which holds:

- Layout rules (1240px `.wrap`, sections, bento/board/split grids)
- Color tokens as Tailwind `@theme` variables (dark canvas, blue + gold accents)
- Spacing scale, radii, shadows
- Component conventions (`web/src/components`: `ui.tsx`, `Summary`, `Leaderboards`, `Tables`, `Heroes`, `ActivityRadar`, `PlayerProfile`, plus `Dashboard`/`RootLayout`/`router`)
- Routing (TanStack Router: `/` and `/player/$playerId`, SPA fallback on CloudFront)
- Data helpers (`web/src/lib/derived.ts`) and hero artwork (`web/src/lib/heroes.ts`)
- The rule that UI copy is English

**How skill loading works:** OpenCode only advertises a skill's ID, name, and
`description` to the model at each step; the full body is added to the
conversation only when the agent calls the `skill` tool with the exact ID
(`design-system`). Because the description is what makes the model notice it,
keep that description clear. The skill ID comes from the directory name, not the
frontmatter `name`.

## End-to-end workflow (proven in practice)

```text
1. Build locally                npm run build
2. Refresh stats fixture        scripts/fetch-stats.sh  (live stats.json + matches.json -> web/dist/)
3. Run the UI suite             npm run test:ui  (Playwright: preview + asserts + screenshots)
4. visual-reviewer subagent     lists issues by severity, with file + fix
5. (you verify the findings)    reports can be wrong or stale — always check
6. frontend agent               implements the fixes in web/src/ and tests/
7. repeat 1–6                   until a fresh run is clean
8. Deploy + live re-check       scripts/deploy-web.sh --wait; then UI_BASE_URL=... npm run test:ui
9. commit
```

Verification happens against a **local `vite preview` build** first, so
unfinished work is never published. The `frontend` agent runs this loop as its
definition of done, and only deploys after a run is clean.

### Step 1–3 — build, seed data, then run Playwright

```bash
npm run build                       # from web/
bash scripts/fetch-stats.sh         # live stats.json (and matches.json) -> web/dist/
npm run test:ui                     # from web/; starts vite preview itself
```

`vite preview` serves `web/dist/`, which never contains `stats.json` (the
aggregator writes it to S3 at deploy time). Without the fixture the SPA fallback
returns `index.html` and the app shows a connection error, so
`scripts/fetch-stats.sh` copies the live file into `web/dist/` after each build.

The lazy `matches.json` is copied alongside it and is optional: a deployment that
has not published it yet is reported by the script, and the detail pages fall back
to the aggregate with an explanatory line. Pass `--skip-matches` to skip it.

Playwright uses the system Google Chrome (`channel: "chrome"`), so no browser
download is needed. `web/tests/dashboard.spec.ts` drives `/` and `/player/<id>`
at 1440px and 360px, asserts real content with no console errors, no uncaught
exceptions, and no horizontal overflow, and writes to `/tmp/opencode/shots/`:

```text
dashboard-desktop.png   1440px, "/"
dashboard-mobile.png     360px, "/"
player-desktop.png      1440px, "/player/<id>"
```

The suite starts its own `vite preview` server locally. Point `UI_BASE_URL` at
another origin (for example the live site) to run the same checks without a
local server:

```bash
UI_BASE_URL=https://dls.rpras.my.id npm run test:ui
```

Add assertions to `web/tests/dashboard.spec.ts` whenever a change introduces new
observable behavior.

`scripts/screenshot-web.sh` remains available as a single-shot fallback
(headless Chrome, `--only all|desktop|mobile|player`); it does not build or
deploy and never touches `web/dist`.

### Step 3 — how to invoke the agents

In the OpenCode TUI, select the agent from the picker, or ask the main agent to
launch a subagent:

- "Use the visual-reviewer subagent to review these screenshots: `/tmp/opencode/shots/*.png`"
- "Use the frontend agent to fix the leaderboard overflow"

Subagents cannot be selected as the main agent — they only run as child sessions.

### Step 4/5 — build and deploy the frontend

Use the helper (`--dry-run` to preview). It reads the bucket and distribution
from `terraform output`, so no IDs are hardcoded:

```bash
scripts/deploy-web.sh --dry-run    # show the plan
scripts/deploy-web.sh --wait       # build + publish + wait for invalidation
```

Under the hood it runs `npm run build`, `aws s3 sync` (excluding `stats.json`
and `index.html`), an `aws s3 cp` of `index.html` with `no-cache`, and a
CloudFront invalidation for `/index.html`, `/`, and `/assets/*`.

`--exclude stats.json` protects the copy the aggregator publishes. Hashed build
assets (`/assets/*`) are cached for a year; `index.html` and `stats.json` are not.

## Editor and permission notes

- `mode: all` lets an agent run either as the main agent or as a subagent.
  `mode: subagent` restricts it to child sessions (used for `visual-reviewer`,
  which must never be the primary driver).
- Permission rules are an ordered list; the last matching rule wins, so put
  broad rules before exceptions.
- `description` is shown to the model when it decides which subagent to launch;
  keep it short and specific.

## Changing models later

Edit the `model:` line in the relevant agent file, for example:

```yaml
model: opencode-go/grok-4.7#high      # vision-capable alternative
model: opencode-go/kimi-k3#max        # strongest reasoning, pricier
model: opencode-go/space-bunny-free   # free exploration
```

Use `/models` in the TUI to browse what is currently enabled and available.
Variant names are model-specific; an unsupported variant is a resolution error.

## Verification checklist (how this setup was validated)

- The `design-system` skill appeared in the agent's available skills after the
  file was created, confirming discovery from `.opencode/skills/`.
- Both vision agents read a real PNG and pointed at specific elements,
  confirming image input works.
- The subagent honoured its read-only permissions.
- Offline render checks use jsdom; the frontend type/build checks are
  `npm run typecheck` and `npm run build` in `web/`.

## Pitfall worth remembering

A reviewer report can describe a stale or non-existent problem. During testing,
one review claimed every populated leaderboard card had lost its title, but the
DOM probe showed the cards were correct. **Treat review output as a hypothesis**
and confirm it against the DOM, a probe script, or a fresh screenshot before
changing code.

## Related docs

- [`docs/architecture.md`](./architecture.md) — AWS pipeline and data layout
- [`README.md`](../README.md) — build, deploy, and batch upload commands
