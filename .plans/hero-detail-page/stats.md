# Stats shown on hero detail page

## Tier 1 (stats.json, always available)
- KPI row: picks, pick rate (`picks / total matches`; confirm total field in `web/src/types/stats.ts`), win rate, W/L, pick rank + WR rank (qualifier >= 3 picks, like PlayerProfile).
- Side split: `radiant_picks`, `dire_picks`, `contested`.
- Avg KDA: summed over `stats.player_heroes[*][heroId]`.
- Used by: players from `stats.player_heroes`, sorted by matches then WR: avatar/name (link to player), matches, WR, KDA.

## Tier 2 (matches.json via `useMatches()`, fallback `.dp-empty` if missing)
- Recent matches with hero: `heroMatchRows(payload, heroId)` (exists in `lib/matches.ts`, unused), `.match-list` style as PlayerProfile.
- Most built final items: count `final_items`, top 6 with `itemImageUrl`, usage % and WR.
- Win rate by game length bucket (<30, 30-40, 40+ min).
- Win rate by side from real match rows.

## Dropped
- gpm/xpm/last hits: player-level, not hero-level.
- Teammate/enemy hero synergy: lobby-only sample too small.
