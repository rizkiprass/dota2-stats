# Link every hero to its detail page

Add shared `HeroLink` in `web/src/components/ui.tsx` wrapping `<Link to="/hero/$heroId" params={{ heroId }}>`. Use it wherever a hero is displayed, on every page.

Find sites by grepping: `heroPortraitUrl`, `heroName`, `hero_name`, hero `Avatar`, `heroLabel`.

Known sites:
- `Heroes.tsx` tiles
- `PlayerProfile.tsx`: `HeroCard`, `HeroPoolDialog`, best/worst hero badges, match rows
- `HeroDistribution.tsx` legend
- `MatchDetail.tsx` player rows
- Matches list
- Dashboard recent matches (`radiant_heroes` / `dire_heroes`)
- Records / leaderboards (`most_picked_hero`, `best_hero_win_rate`)

Caveat: a hero inside an already-linked row (match row `<Link>` to match page) must not nest `<a>`. Use a non-link row wrapper with separate links, or skip the link on that avatar.
