---
name: Design System
description: Design tokens, layout, and component conventions for the static Dota 2 dashboard
---

<!-- Source of truth: web/styles.css and web/app.js -->

## Style

Dark "companion" dashboard: near-black canvas, large rounded panels, soft
shadows, high-contrast bold white headings, generous padding, colorful data
visuals. Sentence-case headings (never uppercase).

## Layout

- Content max width 1240px via `.wrap`; 24px page padding (16px under 560px).
- Structure: `.site-header` -> `main.wrap#app` -> `.site-footer`.
- `.section` blocks hold a `.section-title` plus a card or grid.
- Summary is a bento: `.bento` = 3 equal columns (1 column under 900px).
- Leaderboards use `.board-grid`; the bottom two sections use `.split-grid`
  (2 columns, collapsed under 900px).

## Color tokens (CSS variables)

- Surfaces: `--bg` #0d0d0f, `--bg-2`, `--panel` #1b1b20, `--panel-2` #242429, `--panel-3`
- Lines: `--border` rgba(255,255,255,.06), `--border-strong`
- Text: `--text` #fff, `--text-2`, `--muted` #9b9ba3
- Accents: `--accent` #2f80ed (blue, primary), `--accent-2` #f2c94c (gold, secondary),
  `--positive` #43d17a, `--negative` #eb5757
- Data: `--radiant` = accent, `--dire` = accent-2, `--track` #2c2c33
- Avatar tints: `--av1`..`--av6`
- Always reference a variable; never hardcode a color.

## Shape & type

- Radii: `--radius-sm` 12px, `--radius` 18px, `--radius-lg` 22px, `--pill` 999px.
- `--shadow` / `--shadow-sm` for elevation. 1px `--border`. Base font 15px.

## Components

- `.card` + `.card-head` / `.card-title` / `.card-sub` / `.tile` (`.tile.sm`, `.gold`, `.green`).
- KPI: `.kpi-label` / `.kpi-value` / `.kpi-sub`.
- Stat strip: `.tiles-row > .stat-tile` (`.st-val`, `.st-bar`, `.st-img` with `--tile-accent`).
- Split bar: `.splitbar > i.r` / `i.d` + `.legend` + `.delta`.
- Bars: `.bar > i` (`.bar.gold`).
- Avatars: `.avatar` (`.sm`, `.initial`, `.avatar-pair`); use `avatarElement`,
  `playerAvatar`, `playerCell`, `avatarPair` in `web/app.js`.
- Leaderboards: `.lb` card with `.lb-row` / `.lb-rank` / `.lb-main` / `.lb-val` / `.pill-value`.
- Tables: wrap in a `.card.table-card` (horizontal scroll); right-align numbers with `.num`.
- Hero art: `.hero-grid > .hero-tile` for the Heroes section.
- Player drawer: `.drawer` + `.drawer-backdrop` + `.drawer-body`; sections use `.dp-head`,
  `.dp-kpis/.dp-kpi`, `.dp-rank-row`, `.dp-radar`, `.dp-hero-row`, `.dp-social-row`;
  badges are `.badge` with `.b1` (blue) / `.b2` (gold) / `.b3` (green).
  Opens as a right-side panel on desktop and a bottom sheet under 640px.

## Hero artwork

- `web/heroes.js` maps hero_id -> CDN slug and exposes `heroCropUrl` / `heroPortraitUrl`.
- Generated from OpenDota `/api/heroes`, aligned to the ids in `aggregator/aggregator.py`.
- Always fall back to an initials avatar when the slug is unknown or the image fails.

## Interaction

- Any element with `data-player="<id>"` opens the player drawer (event delegation in `web/app.js`).
- Use `playerButton(id, text)` / `attachPlayer(node, id)` to make a node clickable.
- Deep link `#player=<id>` opens the drawer on load; close with the button, backdrop, or `Esc`.
- The drawer is derived entirely from `stats.json` (no extra requests).

## Language

- All UI copy is English (for example "Summary", "Players", "No data yet").

## Rules

- Vanilla only: no frameworks, no build step, no new dependencies (the CDN images are the one external request).
- Prefer existing classes and CSS variables over new one-off styles.
- Keep all rendering through the shared helpers in `web/app.js`.
