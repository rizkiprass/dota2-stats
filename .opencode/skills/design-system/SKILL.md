---
name: Design System
description: Design tokens, layout, and component conventions for the static Dota 2 dashboard
---

<!-- Source of truth: web/styles.css and web/app.js -->

## Layout

- Content max width 1100px via `.wrap`; 20px page padding.
- Structure: `.site-header` -> `main.wrap#app` -> `.site-footer`.
- Each block is a `.section` with an uppercase accent-bar `<h2>`.

## Color tokens (CSS variables)

- `--bg` #0f1115, `--panel` #171a21, `--panel-2` #1f232c
- `--border` #2a2f3a, `--text` #e7e9ee, `--muted` #9aa3b2
- `--accent` #67c9a5, `--radiant` #6fbf73, `--dire` #cf6b6b

Never hardcode a color; always reference a variable.

## Spacing & shape

- Gaps: 8 / 12 / 14 / 20 / 34 px. Border radius 8px. 1px borders. Subtle shadow.
- Base font 15px, system UI stack.

## Components

- Stat cards: `.cards > .card` with `.label` + `.value` (modifiers `.radiant` / `.dire`).
- Leaderboards: `.grid > .lb` cards, each `.lb h3` plus a small table; empty state uses `.lb .empty`.
- Tables: wrap in `.table-scroll`; right-align numbers with `.num`; highlight names with `.name` and ids with `.tag`.
- Player labels come from `playerLabel(id)` in web/app.js.

## Language

- All UI copy is English (for example "Summary", "Players", "Heroes", "No data yet").

## Rules

- Vanilla only: no frameworks, no build step, no new dependencies.
- Prefer existing classes and CSS variables over new one-off styles.
- Keep all rendering through the shared helpers in `web/app.js`.
