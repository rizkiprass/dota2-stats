---
name: Design System
description: Design tokens, layout, and component conventions for the React Dota 2 dashboard
---

<!-- Source of truth: web/src/styles.css (tokens) and web/src/components -->

## Stack

- React 19 + TypeScript + Vite, styled with Tailwind v4 (tokens + a small
  component stylesheet). No UI framework beyond that; charts are hand-rolled SVG.
- Build output lives in `web/dist/` and is served by S3 + CloudFront.

## Style

Dark "companion" dashboard: near-black canvas, large rounded panels, soft
shadows, high-contrast bold white headings, generous padding, colorful data
visuals. Sentence-case headings (never uppercase).

## Layout

- Content max width 1240px via `.wrap`; 24px page padding (16px under 560px).
- Structure: `<Header>` -> `<main class="wrap">` -> `<footer>`.
- Sections are React components in `web/src/components/`.
- `.bento` = 3 equal columns (1 under 900px); `.board-grid` for leaderboards;
  `.split-grid` for the bottom two sections.

## Color tokens (Tailwind v4 `@theme` in web/src/styles.css)

- Surfaces: `--color-bg`, `--color-bg-2`, `--color-panel`, `--color-panel-2`, `--color-panel-3`
- Lines: `--color-line`, `--color-line-strong`
- Text: `--color-text`, `--color-text-2`, `--color-muted`
- Accents: `--color-accent` #2f80ed, `--color-accent-2` #f2c94c, `--color-positive`, `--color-negative`
- Data: `--color-radiant`, `--color-dire`, `--color-track`
- These produce utilities such as `bg-panel`, `text-muted`, `border-line`, `rounded-card`, `shadow-card`.
- Short aliases (`--panel`, `--accent`, …) exist for the component stylesheet.
- Always reference a token; never hardcode a color.

## Shape & type

- Radii: `--radius-sm` 12px, `--radius-card` 18px, `--radius-lg` 22px. Base font 15px.

## Components (web/src/components)

- `ui.tsx` — `Icon`, `Tile`, `Bar`, `Badge`, `SectionTitle`, `Avatar`,
  `PlayerAvatar`, `AvatarPair`, `PlayerName`, `PlayerCell`.
- `Summary.tsx` — bento: matches KPI + hero tile strip, Radiant/Dire split, at-a-glance.
- `Leaderboards.tsx` — `.lb` cards with `.lb-row` / `.lb-rank` / `.lb-main` / `.lb-val` / `.pill-value`.
- `Tables.tsx` — `Players`, `Teammates`, `HeadToHead` using `.card.table-card` + `.num`.
- `Heroes.tsx` — `.hero-grid > .hero-tile`.
- `ActivityRadar.tsx` — Recharts radar (player vs lobby average).
- `PlayerProfile.tsx` — the `/player/$playerId` page.
- `Dashboard.tsx`, `RootLayout.tsx`, `router.tsx` — routes and shared layout.
- Avatars, icons and bars are shared from `ui.tsx`; do not re-implement them.

## Routing

- TanStack Router with the history API: `/` (dashboard) and `/player/$playerId` (profile).
- Player links are `<Link to="/player/$playerId">` nodes created in `ui.tsx`.
- The player route is lazy-loaded so Recharts stays out of the main bundle.
- CloudFront serves `index.html` for unknown paths (SPA fallback).

## Data & helpers

- `web/src/types/stats.ts` mirrors the aggregator schema.
- `web/src/lib/api.ts` fetches `stats.json` via TanStack Query.
- `web/src/lib/derived.ts` holds rankings, badges, duo/rival helpers and radar axes.
- `web/src/lib/heroes.ts` maps hero_id -> Dota CDN slug (`heroCropUrl` / `heroPortraitUrl`).
- `web/src/lib/theme.ts` reads CSS tokens at runtime for Recharts (which needs concrete colors).
- Always fall back to an initials avatar when the slug is unknown or the image fails.

## Language

- All UI copy is English.

## Rules

- Edit only `web/**`. Use TypeScript; no `any` in new code.
- Run `npm run typecheck` (or `npm run build`) after changes; keep it green.
- No new runtime dependencies without asking first.
- Prefer editing existing components and tokens over new one-off styles.
