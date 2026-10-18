import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Screenshots land here by default so `visual-reviewer` can pick them up by path.
const OUT_DIR = process.env.UI_SHOT_DIR ?? "/tmp/opencode/shots";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 360, height: 800 };

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

async function gotoDetail(page: Page, category: string): Promise<void> {
  const statsLoaded = page.waitForResponse((r) => r.url().endsWith("/stats.json") && r.status() === 200);
  const response = await page.goto(`/leaderboard/${category}`, { waitUntil: "domcontentloaded" });
  expect(response?.status(), "index.html should load").toBe(200);
  await statsLoaded;
  await expect(page.locator(".board-title")).toBeVisible();
}

test("dashboard leaderboard cards link to their detail page", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  // Force one board empty so the static-title branch is deterministic; the live
  // payload may have every board populated as history grows.
  await page.route("**/stats.json", async (route) => {
    const response = await route.fetch();
    const stats = (await response.json()) as { leaderboards: Record<string, unknown> };
    stats.leaderboards.best_kda = [];
    await route.fulfill({ response, json: stats });
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#leaderboards .lb");

  // Cards stay a five-row teaser; the chip copy is gone.
  await expect(page.locator("#leaderboards .lb").first().locator(".lb-row")).toHaveCount(5);
  await expect(page.getByText("View details")).toHaveCount(0);

  const links = page.locator("#leaderboards .lb-hd-link");
  expect(await links.count()).toBeGreaterThan(0);
  // EMPTY boards render a static title instead of a dead link.
  await expect(page.locator("#leaderboards .lb-hd-static")).toHaveCount(1);

  await page.locator("#leaderboards .lb", { hasText: "Highest Win Rate" }).locator(".lb-hd-link").click();
  await expect(page).toHaveURL(/\/leaderboard\/highest_win_rate$/);
  await expect(page.locator(".board-title")).toHaveText("Highest Win Rate");
});

test("all leaderboards and records have dedicated routes", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/leaderboards", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "All leaderboards", exact: true })).toBeVisible();
  await expect(page.locator("#leaderboards .lb")).toHaveCount(10);

  await page.goto("/records", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Records", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Players", exact: true })).toBeVisible();
});

test("duo detail page ranks the full population beyond the card's top 5", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDetail(page, "best_duo_win_rate");

  const rows = page.locator(".board-table tbody tr");
  expect(await rows.count(), "detail must expose more than the card's five").toBeGreaterThan(5);

  await expect(page.locator(".board-count")).toContainText(/Showing \d+ of \d+ · minimum \d+ match/);
  await expect(page.locator(".board-table thead th")).toContainText(["#", "Duo", "Win rate", "Matches", "W–L"]);

  await expect(page.locator(".board-focus")).toHaveCount(0);

  await page.screenshot({ path: `${OUT_DIR}/board-detail-duo.png`, fullPage: true });
});

test("player profile owns leaderboard highlights and match history", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDetail(page, "highest_win_rate");

  await expect(page.locator(".board-focus")).toHaveCount(0);
  await page.locator(".board-table tbody tr").first().locator('a[href^="/player/"]').first().click();
  await expect(page.getByRole("heading", { name: "Hero pool" })).toBeVisible();
  await expect(page.getByText("Signature hero")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent matches" })).toBeVisible();
});

test("hero detail page stays a ranking without a focus panel", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDetail(page, "most_picked_hero");

  await expect(page.locator(".board-focus")).toHaveCount(0);
  await expect(page.locator(".board-table tbody tr").first()).toBeVisible();
});

test("minimum filter, search and sort narrow the ranking", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDetail(page, "best_duo_win_rate");
  const rows = page.locator(".board-table tbody tr");
  const initial = await rows.count();

  const minSelect = page.locator(".board-controls .board-select");
  const options = await minSelect.locator("option").evaluateAll((els) => els.map((el) => (el as HTMLOptionElement).value));
  expect(options.length, "at least one minimum preset").toBeGreaterThan(0);
  const highest = options[options.length - 1];
  await minSelect.selectOption(highest);
  expect(await rows.count(), "raising the minimum must not add rows").toBeLessThanOrEqual(initial);

  await page.locator(".board-search input").fill("zzzznomatch");
  await expect(page.getByText("No entries match these filters")).toBeVisible();
  await page.locator(".board-search input").fill("");

  const toggle = page.locator(".board-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
});

test("unknown category falls back to an error card", async ({ page }) => {
  await page.goto("/leaderboard/not_a_leaderboard", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("alert")).toContainText("Unknown leaderboard");
});

test("mobile detail page renders without horizontal overflow", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await gotoDetail(page, "most_played_rivalry");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "page shell should not scroll horizontally").toBe(0);

  // The head-to-head column is the point of this page; it must be on screen
  // without scrolling the table.
  const primary = await page.locator(".board-table tbody tr").first().locator(".col-primary").boundingBox();
  expect(primary, "primary column should be laid out").not.toBeNull();
  expect(Math.round(primary!.x + primary!.width)).toBeLessThanOrEqual(MOBILE.width);

  await page.screenshot({ path: `${OUT_DIR}/board-detail-mobile.png`, fullPage: true });
});

test("mobile duo rows keep both player names readable", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await gotoDetail(page, "most_played_duo");

  const pair = page.locator(".board-table tbody tr").first().locator("td").nth(1);
  await expect(pair).toBeVisible();
  const names = pair.locator('a[href^="/player/"]:not(:has(img))');
  await expect(names).toHaveCount(2);
  await expect(names).toHaveText([/\S+/, /\S+/]);
  const overflows = await pair.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(overflows, "pair names should wrap instead of truncating or overflowing").toBeFalsy();
});
