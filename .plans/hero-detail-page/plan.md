# Hero detail page

## Context
Heroes show only as non-clickable tiles and cards. No hero page. Add `/hero/$heroId` with pick rate, used-by, win rate, plus extra stats from existing `stats.json` / `matches.json` (no aggregator change). Every hero shown anywhere in the app links to its page.

See [stats.md](stats.md) for stats shown and [linking.md](linking.md) for hero links.

## Changes
- `web/src/router.tsx`: `heroRoute` `path: "/hero/$heroId"`, `lazyRouteComponent(() => import("./components/HeroDetail"), "HeroDetail")`, add to `rootRoute.addChildren`.
- New `web/src/components/HeroDetail.tsx`: `<main className="wrap">`, `back-link`, `dp-section`, `.dp-kpis`/`.dp-kpi`; reuse `Avatar`, `Badge`, `PlayerName`/`PlayerAvatar`, `heroPortraitUrl`, `heroName`, `fmtPct/fmtNum/fmtInt`.
- New `web/src/lib/hero-detail.ts`: pure helpers (pick rate, ranks, usedBy, item usage, duration buckets). Reuse `heroMatchRows`, `summarize` from `lib/matches.ts`.
- New shared `HeroLink` in `web/src/components/ui.tsx`.
- Unknown hero id: `.dp-empty` not-found state.
- Styles: reuse existing classes; minimal `hd-*` in `web/src/styles.css` if needed.

## Verification
- `cd web && npm run build` (typecheck), then `npm run test:ui`.
- New `web/tests/hero-detail.spec.ts` in existing style: mock `stats.json`/`matches.json`, assert KPIs, used-by rows, hero link from tile/player/match pages -> `toHaveURL(/hero/)`, matches-missing fallback, desktop 1440x900 + mobile 360x800.
- Update existing specs if link wrapping breaks locators.
- Manual: `npm run dev`, click heroes across all pages; check no nested-anchor console warnings.
