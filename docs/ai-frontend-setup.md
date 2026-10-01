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
| `frontend` | `opencode-go/gpt-6-luna#high` | Vision-capable and inexpensive (~0.1/0.5 USD per 1M tokens), so design passes stay affordable. |
| `visual-reviewer` | `opencode-go/gpt-6-luna#high` | Must see screenshots. Same model keeps review and build on one visual baseline. |
| `quick-edit` | `opencode-go/deepseek-v4.1-flash#low` | Cheapest, fastest option for mechanical edits; `#low` avoids spending reasoning on trivia. |

Upgrade path for a hard design pass: switch `frontend` to `qwen3.8-max#xhigh`
or `kimi-k3#max` (pricier), or use `space-bunny-free` to explore for free.

## Roles and how they are separated

### `frontend` (primary or subagent)

The builder. Its permissions allow:

- `edit` on `web/**`
- `shell` for `npm run *`, `npm install*`, `npx tsc*`, `node --check*`, `python3 -m http.server*`

Everything else stays permission-controlled, so it cannot wander outside `web/`.
Its system prompt enforces the project's frontend rules: React + TypeScript +
Tailwind, tokens from `web/src/styles.css`, no new runtime dependencies without
asking, run `npm run typecheck` / `npm run build`, small reviewable changes.

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
- Component conventions (`web/src/components`: `ui.tsx`, `Summary`, `Leaderboards`, `Tables`, `Heroes`, `Radar`, `PlayerDrawer`)
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
1. Capture a screenshot       Chrome headless (browser not required)
2. visual-reviewer subagent   lists issues by severity, with file + fix
3. (you verify the findings)   reports can be wrong or stale — always check
4. frontend agent              implements the fixes in web/src/
5. build + deploy              npm run build, aws s3 sync web/dist/, invalidate
6. visual-reviewer again       confirms FIXED, flags any new issue
7. commit
```

### Step 1 — screenshot without a desktop browser

The browser integration needs the desktop app. When it is unavailable, headless
Chrome works:

```bash
google-chrome --headless=new --disable-gpu --no-sandbox \
  --window-size=1440,2400 --virtual-time-budget=9000 \
  --screenshot=/tmp/opencode/shot/dashboard.png \
  "https://d35ludv1nb7o7i.cloudfront.net"
```

Use a second narrow pass (`--window-size=360,2400`) to check responsive layout.

### Step 2 — how to invoke the agents

In the OpenCode TUI, select the agent from the picker, or ask the main agent to
launch a subagent:

- "Use the visual-reviewer subagent to review this screenshot: `<path>`"
- "Use the frontend agent to fix the leaderboard overflow"

Subagents cannot be selected as the main agent — they only run as child sessions.

### Step 4/5 — build and deploy the frontend

```bash
cd web && npm run build
aws s3 sync web/dist/ s3://dta-replay-dashboard-rizkiprass-2026/ \
  --exclude "stats.json" --exclude "index.html" --delete \
  --cache-control "public, max-age=31536000, immutable" \
  --profile pras-sandbox --region us-east-1
aws s3 cp web/dist/index.html s3://dta-replay-dashboard-rizkiprass-2026/index.html \
  --cache-control "no-cache" --profile pras-sandbox --region us-east-1
aws cloudfront create-invalidation --distribution-id E25ZAA5U99KVMM \
  --paths "/index.html" "/stats.json" "/" --profile pras-sandbox --region us-east-1
```

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
