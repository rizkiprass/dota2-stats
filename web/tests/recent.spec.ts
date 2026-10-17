import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Screenshots land here by default so `visual-reviewer` can pick them up by path.
const OUT_DIR = process.env.UI_SHOT_DIR ?? "/tmp/opencode/shots";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 360, height: 800 };

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

interface RecentMatchPlayer {
  account_id: string | null;
  player_name: string | null;
}

interface RecentMatch {
  match_id: string;
  start_time: number | null;
  duration: number;
  radiant_win: boolean;
  radiant_kills: number;
  dire_kills: number;
  radiant_heroes?: Array<number | string>;
  dire_heroes?: Array<number | string>;
  radiant_players?: RecentMatchPlayer[];
  dire_players?: RecentMatchPlayer[];
}

async function gotoDashboard(page: Page): Promise<void> {
  const statsLoaded = page.waitForResponse((r) => r.url().endsWith("/stats.json") && r.status() === 200);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await statsLoaded;
  await expect(page.getByRole("heading", { level: 1, name: /Dota/ })).toBeVisible();
}

/** The same en-GB day label the component renders. */
function dayLabel(page: Page, seconds: number | null): Promise<string> {
  return page.evaluate(
    (value) =>
      value === null
        ? "Date unknown"
        : new Date(value * 1000).toLocaleDateString("en-GB", {
            weekday: "short",
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
    seconds,
  );
}

test("the dashboard shows a bounded recent-match teaser", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDashboard(page);

  const payload = (await (await page.request.get("/stats.json")).json()) as { recent_matches?: RecentMatch[] };
  const recent = payload.recent_matches ?? [];

  const card = page.locator(".recent-card");
  if (recent.length === 0) {
    // An older payload carries no teaser at all.
    await expect(card).toHaveCount(0);
    return;
  }

  await expect(card).toBeVisible();
  await expect(card.locator(".section-title")).toHaveText("Recent matches");

  const rows = card.locator(".recent-row");
  expect(await rows.count(), "the teaser is capped, and bounded by the payload").toBe(Math.min(recent.length, 5));

  // Newest first, and every row agrees with the payload.
  for (let index = 0; index < Math.min(recent.length, 5); index += 1) {
    const entry = recent[index];
    const row = rows.nth(index);
    await expect(row.locator(".recent-date")).toHaveText(await dayLabel(page, entry.start_time));
    await expect(row.locator(".badge")).toHaveText(entry.radiant_win ? "Radiant win" : "Dire win");
    await expect(row.locator(".recent-score")).toContainText(`${entry.radiant_kills}–${entry.dire_kills}`);
  }

  // The card is a teaser: the calendar and lineups live on the history page.
  const link = card.getByRole("link", { name: "All matches" });
  await expect(link).toHaveAttribute("href", "/matches");
  await link.click();
  await expect(page).toHaveURL(/\/matches$/);
});

test("each recent match lists five heroes a side", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDashboard(page);

  const payload = (await (await page.request.get("/stats.json")).json()) as {
    recent_matches?: RecentMatch[];
    heroes: Record<string, { hero_name: string | null }>;
  };
  const withHeroes = (payload.recent_matches ?? []).filter(
    (match) => (match.radiant_heroes ?? []).length > 0 && (match.dire_heroes ?? []).length > 0,
  );

  const strips = page.locator(".recent-heroes");
  if (withHeroes.length === 0) {
    // A payload predating the field renders the row without a strip.
    await expect(strips).toHaveCount(0);
    return;
  }

  const nameOf = (id: number | string) => payload.heroes[String(id)]?.hero_name ?? `Hero ${id}`;
  const rows = page.locator(".recent-row");
  for (let index = 0; index < withHeroes.length; index += 1) {
    const entry = withHeroes[index];
    const strip = rows.nth(index).locator(".recent-heroes");
    const heroes = [...(entry.radiant_heroes ?? []), ...(entry.dire_heroes ?? [])].map(nameOf);

    // Portraits render in payload order, Radiant first, and every tooltip names
    // the hero it fields (a known player is named over it).
    const titles = await strip
      .locator(".avatar")
      .evaluateAll((els) => els.map((el) => el.parentElement?.getAttribute("title") ?? ""));
    expect(titles.length).toBe(heroes.length);
    titles.forEach((title, position) => expect(title).toContain(heroes[position]));

    const sides = strip.locator(".recent-side");
    expect(await sides.count()).toBe(2);
    expect(await sides.first().locator(".avatar").count(), "five a side").toBe(5);
    expect(await sides.nth(1).locator(".avatar").count(), "five a side").toBe(5);
    await expect(strip.locator(".recent-vs")).toHaveText("vs");

    // One labelled group, with both sides named for assistive tech.
    await expect(strip).toHaveAttribute("role", "group");
    const label = (await strip.getAttribute("aria-label")) ?? "";
    expect(label).toContain("Radiant:");
    expect(label).toContain("Dire:");
    heroes.forEach((hero) => expect(label).toContain(hero));
  }
});

test("a portrait links to its player and names them in the tooltip", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.route("**/stats.json", async (route) => {
    const response = await route.fetch();
    const stats = (await response.json()) as {
      recent_matches?: RecentMatch[];
      players: Record<string, { player_name: string | null }>;
    };
    const pair = (heroIds: Array<number | string>, side: string): RecentMatchPlayer[] =>
      heroIds.map((_, index) => {
        const accountId = `test-${side}-${index}`;
        const playerName = `Player${side.toUpperCase()}${index}`;
        // The dashboard resolves names from `players`, so publish the record too.
        stats.players[accountId] = { player_name: playerName };
        return { account_id: accountId, player_name: playerName };
      });
    for (const match of stats.recent_matches ?? []) {
      match.radiant_players = pair(match.radiant_heroes ?? [], "r");
      match.dire_players = pair(match.dire_heroes ?? [], "d");
    }
    await route.fulfill({ response, json: stats });
  });

  await gotoDashboard(page);

  const row = page.locator(".recent-row").first();
  if ((await row.count()) === 0) return; // payload has no teaser at all

  // The un-routed payload still holds the hero ids the row rendered.
  const original = (await (await page.request.get("/stats.json")).json()) as {
    recent_matches?: RecentMatch[];
    heroes: Record<string, { hero_name: string | null }>;
  };
  const first = original.recent_matches?.[0];
  if (!first) return;
  const heroNameOf = (id: number | string) => original.heroes[String(id)]?.hero_name ?? `Hero ${id}`;

  const expected = [
    ...(first.radiant_heroes ?? []).map((heroId, index) => ({ accountId: `test-r-${index}`, playerName: `PlayerR${index}`, hero: heroNameOf(heroId) })),
    ...(first.dire_heroes ?? []).map((heroId, index) => ({ accountId: `test-d-${index}`, playerName: `PlayerD${index}`, hero: heroNameOf(heroId) })),
  ];

  const links = row.locator(".recent-hero-link");
  expect(await links.count(), "every known player is a link, none anonymous").toBe(expected.length);

  for (let index = 0; index < expected.length; index += 1) {
    const link = links.nth(index);
    const { accountId, playerName, hero } = expected[index];
    await expect(link).toHaveAttribute("href", `/player/${accountId}`);
    await expect(link).toHaveAttribute("title", `${playerName} — ${hero}`);
    // The link is named by the player, not the hero, for assistive tech.
    await expect(link).toHaveAccessibleName(playerName);
  }
});

test("portraits stay plain when the payload has no player identities", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.route("**/stats.json", async (route) => {
    const response = await route.fetch();
    const stats = (await response.json()) as { recent_matches?: RecentMatch[] };
    for (const match of stats.recent_matches ?? []) {
      delete match.radiant_players;
      delete match.dire_players;
    }
    await route.fulfill({ response, json: stats });
  });

  await gotoDashboard(page);

  const card = page.locator(".recent-card");
  if ((await card.count()) === 0) return;

  const row = card.locator(".recent-row").first();
  if ((await row.locator(".recent-heroes").count()) === 0) return;

  await expect(row.locator(".recent-hero-link"), "an older payload has no links").toHaveCount(0);
  await expect(row.locator(".recent-hero-plain").first()).toBeVisible();
  // The hero still carries a tooltip, so the strip is never silent.
  const title = await row.locator(".recent-hero-plain").first().getAttribute("title");
  expect(title).toBeTruthy();
});

test("the hero strip is omitted when the payload has no hero ids", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.route("**/stats.json", async (route) => {
    const response = await route.fetch();
    const stats = (await response.json()) as { recent_matches?: RecentMatch[] };
    for (const match of stats.recent_matches ?? []) {
      delete match.radiant_heroes;
      delete match.dire_heroes;
    }
    await route.fulfill({ response, json: stats });
  });

  await gotoDashboard(page);

  const card = page.locator(".recent-card");
  if ((await card.count()) === 0) return; // the payload has no teaser at all

  await expect(card.locator(".recent-heroes")).toHaveCount(0);
  // The row itself still reads: date, winner and score.
  const row = card.locator(".recent-row").first();
  await expect(row.locator(".recent-date")).toBeVisible();
  await expect(row.locator(".badge")).toBeVisible();
  await expect(row.locator(".recent-score")).toContainText("kills");
});

test("the teaser is omitted when the payload has none", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.route("**/stats.json", async (route) => {
    const response = await route.fetch();
    const stats = (await response.json()) as Record<string, unknown>;
    delete stats.recent_matches;
    await route.fulfill({ response, json: stats });
  });

  await gotoDashboard(page);

  await expect(page.locator(".recent-card"), "no empty shell, no error").toHaveCount(0);
  // The rest of the dashboard is unaffected.
  await expect(page.locator("#summary")).toBeVisible();
  await expect(page.locator("#leaderboards .lb").first()).toBeVisible();
  await expect(page.getByRole("alert"), "still no connection-error card").toHaveCount(0);
});

test("the recent-match teaser is compact on mobile", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await gotoDashboard(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "the dashboard should not scroll horizontally").toBe(0);

  // A payload without the teaser renders no card; the overflow check above still counts.
  if ((await page.locator(".recent-card").count()) === 0) return;
  await page.locator(".recent-card").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT_DIR}/recent-mobile.png` });
});
