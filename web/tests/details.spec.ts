import { test, expect, type Locator, type Page } from "@playwright/test";
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
  const response = await page.goto(`/leaderboard/${category}`);
  expect(response?.status(), "index.html should load").toBe(200);
  await statsLoaded;
  await expect(page.locator(".board-title")).toBeVisible();
}

test("dashboard leaderboard cards link to their detail page", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/");
  await page.waitForSelector("#leaderboards .lb");

  // Cards stay a five-row teaser; the chip copy is gone.
  await expect(page.locator("#leaderboards .lb").first().locator(".lb-row")).toHaveCount(5);
  await expect(page.getByText("View details")).toHaveCount(0);

  const links = page.locator("#leaderboards .lb-hd-link");
  expect(await links.count()).toBeGreaterThan(0);
  // EMPTY boards render a static title instead of a dead link.
  await expect(page.locator("#leaderboards .lb-hd-static")).toHaveCount(1);

  await page.locator("#leaderboards .lb", { hasText: "Best Duo Win Rate" }).locator(".lb-hd-link").click();
  await expect(page).toHaveURL(/\/leaderboard\/best_duo_win_rate$/);
  await expect(page.locator(".board-title")).toHaveText("Best Duo Win Rate");
});

test("duo detail page ranks the full population beyond the card's top 5", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDetail(page, "best_duo_win_rate");

  const rows = page.locator(".board-table tbody tr");
  expect(await rows.count(), "detail must expose more than the card's five").toBeGreaterThan(5);

  await expect(page.locator(".board-count")).toContainText(/Showing \d+ of \d+ · minimum \d+ match/);
  await expect(page.locator(".board-table thead th")).toContainText(["#", "Duo", "Win rate", "Matches", "W–L"]);

  // Extra blocks: togetherness coverage + partnerships per player.
  await expect(page.getByText("Togetherness")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Partnerships for" })).toBeVisible();
  await expect(page.locator(".board-partnerships")).toBeVisible();

  await page.screenshot({ path: `${OUT_DIR}/board-detail-duo.png`, fullPage: true });
});

test("player detail page shows the compact profile highlights", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDetail(page, "highest_win_rate");

  const focus = page.locator(".board-focus");
  await expect(focus).toContainText("Signature hero");
  await expect(focus).toContainText("Best duo");
  await expect(focus).toContainText("Toughest rival");
});

test("hero detail page lists who played the hero", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDetail(page, "most_picked_hero");

  await expect(page.locator(".board-focus")).toContainText(/Picked by \d+ player/);
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

/** The lazy payload may still be in flight: settle on rows, or the explicit note. */
async function historyState(history: Locator): Promise<"rows" | "note" | "pending"> {
  if ((await history.locator(".match-row").count()) > 0) return "rows";
  if ((await history.getByText(/Per-match history isn.t published/).count()) > 0) return "note";
  return "pending";
}

test("detail pages surface per-match history when it is published", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoDetail(page, "best_duo_win_rate");

  const history = page.locator(".board-history");
  await expect(history).toBeVisible();
  await expect(history.locator(".board-focus-title").first()).toHaveText("Played together");

  // matches.json is optional per deployment: either rows render, or the block
  // says so instead of looking broken.
  await expect.poll(() => historyState(history), { timeout: 15_000 }).not.toBe("pending");
  if ((await historyState(history)) === "note") {
    await expect(history).toContainText(/Per-match history isn.t published/);
  } else {
    await expect(history.locator(".board-badges .badge").first()).toBeVisible();
    await expect(history.locator(".match-result").first()).toHaveText(/^[WL]$/);
  }

  // Every family wires its own history view.
  for (const category of ["highest_win_rate", "most_played_rivalry", "most_picked_hero"]) {
    await gotoDetail(page, category);
    await expect(page.locator(".board-history .board-focus-title").first()).toBeVisible();
    await expect.poll(() => historyState(page.locator(".board-history")), { timeout: 15_000 }).not.toBe("pending");
  }
});

test("unknown category falls back to an error card", async ({ page }) => {
  await page.goto("/leaderboard/not_a_leaderboard");
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
