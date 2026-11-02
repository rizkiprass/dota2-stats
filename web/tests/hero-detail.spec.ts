import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

const OUT_DIR = process.env.UI_SHOT_DIR ?? "/tmp/opencode/shots";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 360, height: 800 };

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

async function gotoRecords(page: Page): Promise<void> {
  const statsLoaded = page.waitForResponse((r) => r.url().endsWith("/stats.json") && r.status() === 200);
  await page.goto("/records", { waitUntil: "domcontentloaded" });
  await statsLoaded;
  await expect(page.locator("#heroes")).toBeVisible();
}

async function openFirstHero(page: Page): Promise<void> {
  await gotoRecords(page);
  const tile = page.locator(".hero-grid a.hero-tile").first();
  await tile.scrollIntoViewIfNeeded();
  await tile.click();
  await expect(page).toHaveURL(/\/hero\/\d+/);
}

test("hero tile opens the hero detail page with core stats", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await openFirstHero(page);

  await expect(page.locator(".dp-name")).toBeVisible();
  for (const label of ["Pick rate", "Win rate", "Picks", "Avg KDA"]) {
    await expect(page.locator(".dp-kpi .k-label", { hasText: label }).first()).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "Used by" })).toBeVisible();
  await expect(page.locator(".dp-hero-row").first()).toBeVisible();
  await page.screenshot({ path: `${OUT_DIR}/hero-detail-desktop.png`, fullPage: true });
});

test("hero detail fits a phone without horizontal scroll", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await openFirstHero(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.screenshot({ path: `${OUT_DIR}/hero-detail-mobile.png`, fullPage: true });
});

test("hero detail degrades when matches.json is not published", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.route("**/matches.json", (route) => route.fulfill({ status: 404, body: "" }));
  await openFirstHero(page);

  await expect(page.getByText("Per-match history is not published for this deployment yet.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Used by" })).toBeVisible();
});

test("unknown hero id shows a not-found state", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  const statsLoaded = page.waitForResponse((r) => r.url().endsWith("/stats.json") && r.status() === 200);
  await page.goto("/hero/999999", { waitUntil: "domcontentloaded" });
  await statsLoaded;
  await expect(page.locator(".dp-empty", { hasText: "not found" })).toBeVisible();
});

test("heroes link to their detail page from the dashboard, player and match pages", async ({ page }) => {
  await page.setViewportSize(DESKTOP);

  const statsLoaded = page.waitForResponse((r) => r.url().endsWith("/stats.json") && r.status() === 200);
  await page.goto("/matches", { waitUntil: "domcontentloaded" });
  await statsLoaded;
  await expect(page.locator("a.hero-link").first()).toBeVisible();
  await expect(page.locator("a a"), "no nested anchors").toHaveCount(0);

  await page.locator("a.hero-link").first().click();
  await expect(page).toHaveURL(/\/hero\/\d+/);

  // Used-by rows link on to the player profile, which links back to heroes.
  await page.locator(".dp-hero-row a.player-link").first().click();
  await expect(page).toHaveURL(/\/player\//);
  await expect(page.locator(".hero-pool-grid a.hero-card").first()).toBeVisible();
  await expect(page.locator("a a"), "no nested anchors").toHaveCount(0);
});

test("recent appearances paginate ten at a time", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.route("**/matches.json", async (route) => {
    const response = await route.fetch();
    const payload = (await response.json()) as {
      matches: Array<{ match_id: string; start_time: number | null; duration: number; radiant_win: boolean; players: Array<Record<string, unknown>> }>;
    };
    // Clone the first match so its first hero appears 25 times.
    const [base] = payload.matches;
    payload.matches = Array.from({ length: 25 }, (_, index) => ({
      ...base,
      match_id: `9000${index}`,
      start_time: (base.start_time ?? 1_700_000_000) - index * 86_400,
    }));
    await route.fulfill({ response, json: payload });
  });

  const statsLoaded = page.waitForResponse((r) => r.url().endsWith("/stats.json") && r.status() === 200);
  await page.goto("/matches", { waitUntil: "domcontentloaded" });
  await statsLoaded;
  await page.locator(".match-heroes a.hero-link, .mc-lineups a.hero-link").first().click();
  await expect(page).toHaveURL(/\/hero\/\d+/);

  const rows = page.locator(".profile-history .match-row");
  const label = page.locator(".hd-pager-label");
  await expect(rows).toHaveCount(10);
  await expect(label).toHaveText("Page 1 of 3");
  await expect(page.getByRole("button", { name: "Previous page" })).toBeDisabled();

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(label).toHaveText("Page 2 of 3");
  await expect(rows).toHaveCount(10);

  await page.getByRole("button", { name: "Next page" }).click();
  await expect(label).toHaveText("Page 3 of 3");
  await expect(rows).toHaveCount(5);
  await expect(page.getByRole("button", { name: "Next page" })).toBeDisabled();
});
