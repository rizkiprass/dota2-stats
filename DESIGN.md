---
name: Dota 2 Private Lobby Statistics
description: A dark companion dashboard that turns private-lobby replays into one trustworthy all-time ledger.
colors:
  obsidian-canvas: "#0d0d0f"
  obsidian-canvas-2: "#131316"
  charcoal-panel: "#1b1b20"
  charcoal-panel-2: "#242429"
  charcoal-panel-3: "#2c2c33"
  hairline: "rgba(255, 255, 255, 0.06)"
  hairline-strong: "rgba(255, 255, 255, 0.12)"
  chalk-white: "#ffffff"
  chalk-2: "#c9c9d1"
  ash-grey: "#9b9ba3"
  radiant-azure: "#2f80ed"
  dire-gold: "#f2c94c"
  victory-green: "#43d17a"
  defeat-red: "#eb5757"
  medal-gold: "#f2c94c"
  medal-silver: "#c7ccd6"
  medal-bronze: "#cd8a57"
  meter-track: "#2c2c33"
  radiant-soft: "rgba(47, 128, 237, 0.16)"
  dire-soft: "rgba(242, 201, 76, 0.16)"
  victory-soft: "rgba(67, 209, 122, 0.14)"
  avatar-azure: "#2f80ed"
  avatar-amber: "#c99b3a"
  avatar-green: "#43d17a"
  avatar-violet: "#8b5cf6"
  avatar-pink: "#e0619b"
  avatar-teal: "#2bb6b0"
typography:
  display:
    fontFamily: "Sora, Inter, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.9px"
  headline:
    fontFamily: "Sora, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.3px"
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 700
    lineHeight: 1.3
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "0.2px"
rounded:
  sm: "12px"
  tile: "14px"
  card: "18px"
  lg: "22px"
  pill: "999px"
spacing:
  xs: "6px"
  sm: "10px"
  md: "16px"
  lg: "22px"
  xl: "26px"
components:
  card:
    backgroundColor: "{colors.charcoal-panel}"
    textColor: "{colors.chalk-white}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "22px"
  card-title:
    textColor: "{colors.chalk-white}"
    typography: "{typography.headline}"
  badge:
    backgroundColor: "{colors.charcoal-panel-2}"
    textColor: "{colors.chalk-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  badge-accent:
    backgroundColor: "{colors.radiant-soft}"
    textColor: "{colors.radiant-azure}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "4px 10px"
  pill-value:
    backgroundColor: "{colors.dire-soft}"
    textColor: "{colors.dire-gold}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "3px 10px"
  search-input:
    backgroundColor: "{colors.charcoal-panel-2}"
    textColor: "{colors.chalk-white}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 34px 8px 12px"
  nav-link:
    textColor: "{colors.ash-grey}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 12px"
  nav-link-active:
    backgroundColor: "{colors.radiant-soft}"
    textColor: "{colors.chalk-white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "7px 12px"
  icon-tile:
    backgroundColor: "{colors.charcoal-panel-2}"
    textColor: "{colors.radiant-azure}"
    rounded: "{rounded.tile}"
    size: "46px"
  rank-medal:
    backgroundColor: "{colors.medal-gold}"
    textColor: "{colors.obsidian-canvas}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    size: "24px"
  progress-bar:
    backgroundColor: "{colors.radiant-azure}"
    rounded: "{rounded.pill}"
    height: "6px"
  tag:
    backgroundColor: "{colors.charcoal-panel-2}"
    textColor: "{colors.ash-grey}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "1px 7px"
  card-header-link:
    textColor: "{colors.chalk-white}"
    typography: "{typography.headline}"
  control-select:
    backgroundColor: "{colors.charcoal-panel-2}"
    textColor: "{colors.chalk-white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 12px"
  control-toggle:
    backgroundColor: "{colors.charcoal-panel-2}"
    textColor: "{colors.chalk-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  control-toggle-active:
    backgroundColor: "{colors.radiant-soft}"
    textColor: "{colors.chalk-white}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  table-header:
    textColor: "{colors.ash-grey}"
    typography: "{typography.label}"
    padding: "14px 18px"
  match-combo:
    backgroundColor: "{colors.charcoal-panel-2}"
    textColor: "{colors.chalk-2}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "6px 10px"
---

# Design System: Dota 2 Private Lobby Statistics

## Overview

**Creative North Star: "The Lobby Ledger"**

This is a ledger before it is a dashboard. The group's shared match history is the product, and the interface behaves like a well-kept record book that happens to be alive: a near-black page, generous rounded panels laid out in a calm grid, and every number set in tabular figures so columns line up the way a handwritten ledger would. Hero art, medals, and colored meters are the illustrations in the margins — they give the book its world without ever competing with the figures.

The density is middle-of-the-road and deliberate. Cards are large and padded, sections are separated by a consistent 26px rhythm, and the whole thing stays legible on a phone without collapsing into a list. Depth is tonal at rest: the page is `obsidian-canvas`, cards are `charcoal-panel`, inner wells step up to `charcoal-panel-2` and `-3`. A single soft shadow and a 3px hover lift are the only structural motion the surfaces themselves perform.

The atmosphere is calm and precise, with a quiet competitive edge underneath. Radiant and Dire are always present as the two data poles, leaderboards use real medal tiers, and the eye is trained to read rank first and value second. Nothing shouts; the numbers are trusted, so the design does not need to sell them.

**Key Characteristics:**
- Near-black canvas with large, softly shadowed rounded panels.
- Sentence-case Sora headings over Inter body and tabular-figure numbers.
- Radiant azure and Dire gold as the two semantic data poles.
- Gold reserved for earned achievement (rank 1, medals, leading values).
- Hero art used as spotlight and tile imagery, never as background noise.
- One hover lift everywhere; one soft card shadow; no elevation ladder.

## Colors

A near-black neutral field carrying one cool accent and one warm accent, with green/red kept strictly for outcome semantics.

### Primary

- **Radiant Azure** (#2f80ed): the system's primary accent. Active nav pills, icon-tile glyphs, progress bars, player-link hover, focus rings, the brand mark gradient, and the Radiant side of every split. It is the default answer when a surface needs "the important thing".

### Secondary

- **Dire Gold** (#f2c94c): the warm counterpart and the medal metal. It carries the Dire side of splits and, through `pill-value`, the leading value in a leaderboard row. Because it reads as gold, it is understood as an award rather than a second brand color.

### Tertiary

- **Victory Green** (#43d17a) and **Defeat Red** (#eb5757): outcome semantics only — win/loss text, the delta indicator, the error mark. They are never used for identity, emphasis, or decoration.

### Neutral

- **Obsidian Canvas** (#0d0d0f) / **Obsidian Canvas 2** (#131316): the page floor and its ambient gradient bed.
- **Charcoal Panel** (#1b1b20): the surface of every card and leaderboard tile.
- **Charcoal Panel 2** (#242429) / **Charcoal Panel 3** (#2c2c33): inner wells — stat tiles, hero tiles, badges, track backgrounds, `kbd` chips.
- **Chalk White** (#ffffff): primary text and headings.
- **Chalk 2** (#c9c9d1): secondary text inside otherwise prominent content.
- **Ash Grey** (#9b9ba3): labels, captions, table headers, inactive nav.
- **Hairline** (`rgba(255,255,255,0.06)`) / **Hairline Strong** (`rgba(255,255,255,0.12)`): dividers between rows, table cell borders, and the border on inner wells.
- **Medal silver** (#c7ccd6) and **Medal bronze** (#cd8a57) complete the podium; **avatar azure/amber/green/violet/pink/teal** are the initials-avatar tints, assigned by name hash so a player keeps a consistent color.

### Named Rules

**The Earned Gold Rule.** Dire gold is payment, not paint. It is allowed on medal tiers, `pill-value` leaders, the MVP marker, and the Dire side of a split — and nowhere else. If gold is decorative, it is wrong.

**The Radiant/Dire Rule.** Radiant is azure and Dire is gold, always, in that pairing. This deliberately does not mirror the in-game team colors; it maps the two sides onto the system's cool/warm accent pair so a split bar reads instantly in a dark UI.

**The Token Rule.** Never hardcode a color; reference a token. Every value above exists as a CSS custom property in `web/src/styles.css`.

## Typography

**Display Font:** Sora (with Inter, system-ui fallback)
**Body Font:** Inter (with system-ui, Segoe UI, Roboto fallback)

**Character:** A geometric display face for titles and figures, a neutral grotesque for everything you actually read. Sora gives the panel headings and KPI values a modern, slightly technical weight; Inter keeps tables, captions, and long labels quiet and scannable. Both are loaded from Google Fonts with weights 500–800 (Sora) and 400–800 (Inter).

### Hierarchy

- **Display** (Sora 800, 26–36px, line-height 1.05, letter-spacing ≈ -0.9px): KPI values, spotlight name, profile name. Always paired with tabular figures.
- **Headline** (Sora 700, 16px, -0.3px): section titles and card titles.
- **Title** (Inter 700, 14px): row and column leaders inside tables and leaderboards — player names, the value column.
- **Body** (Inter 400, 15px, line-height 1.5): prose, table cells, error copy; captions step down to 12–13px in `ash-grey`.
- **Label** (Inter 600, 12px, +0.2px): table headers, badges, nav items, KPI labels, tags.

### Named Rules

**The Sentence-Case Rule.** Headings and labels are sentence case. Uppercase is never used to signal hierarchy — weight and size carry it.

**The Tabular Rule.** Every number that can appear in a column or a ranking is set with `font-variant-numeric: tabular-nums`. Figures must align vertically; the ledger depends on it.

## Layout

A single centered column, `.wrap` at max-width 1240px with 24px page padding (16px below 560px), holding a sticky `.site-header` (14px vertical padding, 80%-opaque blurred canvas), then a stack of `.section` blocks separated by 26px, then a centered footer.

The internal grid is a small, fixed vocabulary:

- **`.bento`** — three equal cards, `gap: 16px`; collapses to one column below 900px. Holds the summary KPIs.
- **`.split-grid`** — two equal columns, `gap: 16px`; collapses to one below 900px. Holds the bottom pair of sections.
- **`.spotlight`** — a 1.7fr / 1fr pair (hero art + player of the lobby), `gap: 16px`, collapsing below 900px.
- **`.board-grid`** — `repeat(auto-fill, minmax(320px, 1fr))`, `gap: 16px`; at ≥1100px a lone trailing card spans two columns instead of leaving a hole.
- **`.hero-grid`** — `repeat(auto-fill, minmax(104px, 1fr))`, `gap: 12px`; 88px minimum below 560px.

Sections are anchored and use `scroll-margin-top: 86px` (118px below 560px) so the sticky header does not cover a jumped-to heading. Inside cards the rhythm is looser: 22px padding, rows at 9–12px vertical padding separated by hairlines.

A leaderboard detail page replaces the grid with one `.board-page` column (max-width 1100px): a head block, a three-up summary strip, a control row, and a single ranked table, followed by the focus block.

## Elevation & Depth

Hybrid, but weighted toward tone. Depth is primarily tonal — three panel steps rising from a near-black canvas — and a single soft shadow does the rest. There is no elevation ladder: cards and leaderboard tiles all sit at the same level (`0 12px 32px rgba(0,0,0,0.38)` plus a 1px inner top highlight), and elevation only changes as a response to state.

### Shadow Vocabulary

- **Card resting** (`box-shadow: 0 12px 32px rgba(0,0,0,0.38), inset 0 1px 0 rgba(255,255,255,0.05)`): the default flat-on-the-page state of any panel.
- **Card hover** (`box-shadow: var(--shadow-card), 0 14px 34px color-mix(in srgb, var(--accent) 10%, transparent), inset 0 1px 0 rgba(255,255,255,0.07)`): adds a faint azure bloom as the card lifts 3px.
- **Brand mark** (`0 8px 22px rgba(47,128,237,0.35)`): the one colored glow in the header; it belongs to the logo only.
- **Medal** (`0 4px 12px rgba(0,0,0,0.35)`): separates the circular podium badge from the row behind it.
- **Tile hover** (`0 10px 22px color-mix(in srgb, var(--accent) 20%, transparent)`): accent-tinted lift for hero and stat tiles.

### Named Rules

**The One Lift Rule.** A surface lifts exactly once, by 3px, on hover. No static elevation hierarchy, no stacked shadows, no parallax.

**The Respectful Motion Rule.** Every animation is disabled or reduced under `prefers-reduced-motion: reduce`, including the lift transform and the ambient background drift.

## Shapes

A softly rounded, generously curved system. The radius ladder is short and intentional: 12px for inner wells and inputs, 14px for icon tiles, 18px for cards and leaderboard tiles (the `--radius` default), 22px for the largest panels, and full pills for chips, nav items, the search field, meters, and tags.

Panels are clipped cleanly (`overflow: hidden` where imagery or bars need it) and never nested inside one another — cards hold content, not other cards. Two recurring silhouette details define the look:

- **The lit edge.** Cards and leaderboard tiles draw their 1px border as a gradient (azure-tinted at the top-left, warm-tinted at the bottom-right, hairline through the middle) using a `border-box` background trick rather than a flat gray stroke.
- **The accent cap.** Hero tiles and stat tiles carry a 3px `border-top` in the hero's tint color (`--tile-accent`), which doubles as the only place a per-hero color enters the UI.

Circular shapes are reserved for identity: avatars are full circles, and `AvatarPair` overlaps two by 12px with a 2px panel-colored ring. Progress and split bars are fully pill-rounded; the track is always `meter-track` (#2c2c33).

## Components

### Buttons

- **Shape:** rounded at 12px (`.sm` radius) — buttons are the one control that is *not* a pill, which keeps them visually distinct from chips and nav.
- **Primary / Retry:** translucent azure on panel (`color-mix(in srgb, var(--accent) 15%, var(--panel))`) with a 42%-mixed azure border, `chalk-white` text at 13px/700, `padding: 9px 14px`.
- **Hover / Focus:** hover lifts 1px and deepens the azure mix to 23%; `:focus-visible` uses a 2px azure outline at 3px offset. Disabled shows a wait cursor at 70% opacity.

There is no generic secondary/ghost button in the incumbent system; actions elsewhere are player links and nav pills.

### Chips

- **Badge:** `charcoal-panel-2` background, `chalk-2` text, hairline border, pill radius, 11.5px/700, 4px 10px padding.
- **Tone variants:** `b1` azure-on-`radiant-soft`, `b2` gold-on-`dire-soft`, `b3` green-on-`victory-soft` — borderless, for achievement and profile badges.
- **Tag:** the smallest chip, `charcoal-panel-2` on 11px text with 1px 7px padding, used inline after names.
- **Pill value:** gold-on-`dire-soft`, 13px/800 — the leader's number in a leaderboard row.

### Cards / Containers

- **Corner Style:** 18px (`--radius`), 22px for the largest panels.
- **Background:** `charcoal-panel`, with a subtle 145° gradient toward `charcoal-panel-2` and the gradient border described in Shapes.
- **Shadow Strategy:** see Elevation & Depth — one resting shadow, one hover bloom.
- **Border:** 1px, transparent, painted by the gradient border-box background.
- **Internal Padding:** 22px (18px below 560px); table cards drop to 4px vertical so rows can span edge to edge.

### Inputs / Fields

- **Style:** the search field is a pill (`border-radius: 999px`) on `charcoal-panel-2` with a `hairline-strong` border, 13px text, `padding: 8px 34px 8px 12px`, max-width 230px (full-width below 560px).
- **Focus:** border shifts to a 52%-mixed azure plus a 3px azure-soft ring — no outline.
- **Affordance:** a `kbd` chip sits inside the right edge showing the shortcut key; it is `pointer-events: none` and never interactive.

### Navigation

- **Style:** a horizontally scrollable pill row in the sticky header, pushed to the right with `margin-left: auto`. Each link is 13px/600 `ash-grey` on a transparent pill with a 1px transparent border.
- **States:** hover turns text `chalk-white` on a 5% white wash; active uses a 16%-mixed azure background with a 34%-mixed azure border and white text. The active item is chosen by scroll-spy, not by route alone.
- **Mobile (≤560px):** the nav drops to its own full-width row, wraps under the brand, keeps the horizontal scroll, and fades its right edge with a mask.

### KPI Value (signature)

The `.kpi-value` is the system's one piece of decorative type: a 36px Sora 800 figure (30px below 560px) painted with a 105° gradient from `chalk-white` through azure-mixed white into `dire-gold` using `background-clip: text`, with tabular figures and -1.3px tracking. It appears once per summary panel and is the visual anchor of the dashboard.

### Leaderboard Row (signature)

`.lb` tiles hold `.lb-row` units: a 20px rank cell, a flexible `.lb-main` (name, optional sub-line, a 220px-max azure bar), and a right-aligned `.lb-val`. Ranks 1–3 replace the numeral with a 24px circular medal — gold, silver, or bronze gradient, `obsidian-canvas` numeral, `0 4px 12px` shadow — which is the only place the podium colors appear.

Card tiles are a **five-row teaser**, never a full list. The header is a `.lb-hd-link` — the card title plus a 13px chevron, with no chip or label text — that navigates to the category's detail page. A board with no qualifying entries renders a static `.lb-hd-static` title instead, so an empty card is never a dead link.

### Ranked Tables (signature)

Detail pages rank the *full* population from the aggregate maps (`players`, `heroes`, `teammates`, `head_to_head`) inside a `.card.table-card`. The category's own metric is always the **first numeric column**, followed by a fixed per-family set (player: Matches, W–L, Win rate, KDA; hero: Picks, W–L, Win rate; duo: Matches, W–L, Win rate; rivalry: Head-to-head). Every numeric column is right-aligned in tabular figures, and the rank-1 numeral takes the gold accent.

The gold `pill-value` marks only a **winning value** (≥50%) — a 0% entry renders as plain text, so the pill keeps meaning "earned".

Below 560px the secondary columns are hidden and only rank, entity, and the primary metric remain; the primary metric is the category metric, except on the rivalry table, where Head-to-head is kept. The entity label truncates with an ellipsis rather than pushing the metric off-screen.

### Detail Controls

Two pill controls sit above a ranked table, matching the search field's shape: `.board-select` (a native `<select>` for the minimum sample size or the focus entity) and `.board-toggle` (a sort switch, styled with `aria-pressed="true"` as an azure-soft pill). Both are 13px, `charcoal-panel-2`, and share the input's azure focus ring.

### Head-to-Head Split

A pairing's score uses the `.splitbar` two-sided meter already used for Radiant/Dire: azure for the first player, Dire gold for the second, with the `2–0` score set beside it in tabular figures. The two colors name the two sides, not an award — a split bar is the system's established way to compare two parties.

### Per-Match History (signature)

`.board-history` closes a detail page with the per-match record, loaded lazily from `matches.json` so history can grow without inflating the payload the dashboard always fetches. Each `.match-row` is a five-column grid: the date, the hero portrait(s) as overlapping avatars, the hero name(s), the player's K/D/A in tabular figures, and a single `W`/`L` letter tinted by outcome. Above the list, `.badge` chips summarise the run — matches published, W–L, a win or loss streak, and the first and last date.

`.match-combo` chips collect the hero pairings a duo actually ran, most frequent first, each an avatar pair plus `3× · 67%`.

The payload is optional: when `matches.json` is absent the block prints one explanatory line and the rest of the page is unaffected. The page must never look broken because a secondary payload is missing.

### Hero Tile (signature)

`.hero-tile` is a square-cropped hero portrait in a 12px-radius well with a 3px top border in the hero's tint. Hover lifts it 4px and scales the portrait 1.045; the name and a two-column stat line sit below. `.stat-tile` in the summary uses the same cap-and-lift language at a smaller size.

### Avatar (signature)

38px full circle (30px `.sm`, 58px `.lg`) on `charcoal-panel-3`. When hero art is available it fades in over an initials fallback at the same size; when it is not, the fallback gets a per-name gradient tint from `--av`. `AvatarPair` overlaps two avatars by 12px with a 2px `charcoal-panel` ring.

## Do's and Don'ts

### Do:

- **Do** reference a token for every color, radius, and shadow; the token set lives in `web/src/styles.css` and the `design-system` skill documents it.
- **Do** set every column, rank, and KPI figure in `tabular-nums`, and give numeric columns `text-align: right`.
- **Do** reserve `dire-gold` for earned gold: medal tiers, `pill-value`, the MVP marker, and the Dire side of a split.
- **Do** keep Radiant = azure and Dire = gold as a fixed pairing in every split, legend, and dot.
- **Do** use sentence case for headings and labels, and let size and weight carry hierarchy.
- **Do** keep one hover lift (3px on cards and leaderboard tiles, 4px on hero tiles) and reduce all motion under `prefers-reduced-motion`.
- **Do** fall back to a tinted initials avatar whenever hero art is missing or fails to load.
- **Do** treat a leaderboard card header as navigation: the title plus a chevron, with a static title when the board has no entries so the card never looks clickable and does nothing.
- **Do** keep a category's metric as the first numeric column, in tabular figures, and keep it on screen at phone width.
- **Do** reserve the gold `pill-value` for winning values (≥50%); a 0% entry is plain text.
- **Do** treat an optional payload as optional: a missing `matches.json` becomes one explanatory line, never an error page or an empty-looking block.

### Don't:

- **Don't** hardcode a hex in a component; if a value is missing, add it to `@theme` first.
- **Don't** use victory green or defeat red for anything other than win/loss and error semantics.
- **Don't** use uppercase, letter-spaced headings as a hierarchy device.
- **Don't** nest cards inside cards — panels hold content, and depth is expressed by the panel ramp instead.
- **Don't** introduce a second resting shadow or a static elevation ladder; one shadow, one hover lift.
- **Don't** use gold or a hero tint as a general-purpose highlight; both are earned or attached to a specific entity.
- **Don't** ship a control that looks interactive but has no action — a header affordance either navigates or is not rendered.
- **Don't** add decorative gradients, glows, or bounce/elastic easing outside the existing ambient background drift.
