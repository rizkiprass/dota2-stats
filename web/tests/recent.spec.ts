import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Screenshots land here by default so `visual-reviewer` can pick them up by path.
const OUT_DIR = process.env.UI_SHOT_DIR ?? "/tmp/opencode/shots";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 360, height: 800 };

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

interface RecentMatch {
  match_id: string;
  start_time: number | null;
  duration: number;
  radiant_win: boolean;
  radiant_kills: number;
  dire_kills: number;
}

async function gotoDashboard(page: Page): Promise<void> {
  const statsLoaded = page.waitForResponse((r) => r.url().endsWith("/stats.json") && r.status() === 200);
  await page.goto("/");
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
