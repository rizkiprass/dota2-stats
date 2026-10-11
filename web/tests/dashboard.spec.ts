import { test, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Screenshots land here by default so `visual-reviewer` can pick them up by path.
const OUT_DIR = process.env.UI_SHOT_DIR ?? "/tmp/opencode/shots";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 360, height: 800 };

// Remote fonts and hero art can fail without meaning the app is broken.
function isResourceError(message: ConsoleMessage): boolean {
  const text = message.text();
  return text.includes("Failed to load resource") || text.includes("net::");
}

function watchPage(page: Page): { consoleErrors: string[]; pageErrors: string[] } {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && !isResourceError(message)) consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => pageErrors.push(error.message));
  return { consoleErrors, pageErrors };
}

async function gotoDashboard(page: Page): Promise<void> {
  // Set the waiter up before navigation so a fast fetch cannot be missed.
  const statsLoaded = page.waitForResponse((r) => r.url().endsWith("/stats.json") && r.status() === 200);
  const response = await page.goto("/");
  expect(response?.status(), "index.html should load").toBe(200);
  await statsLoaded;
  await expect(page.getByRole("heading", { level: 1, name: /Dota/ })).toBeVisible();
  await expect(page.getByRole("alert"), "no connection-error card").toHaveCount(0);
}

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * Responsive charts re-measure after a viewport change, so poll instead of
 * sampling once: a late resize must not read as a permanent layout bug.
 */
async function expectNoOverflow(page: Page, message: string): Promise<void> {
  await expect
    .poll(() => horizontalOverflow(page), { timeout: 5_000, message })
    .toBe(0);
}

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

test("desktop dashboard renders and captures", async ({ page }) => {
  const errors = watchPage(page);
  await page.setViewportSize(DESKTOP);
  await gotoDashboard(page);

  expect(await horizontalOverflow(page), "desktop should not scroll horizontally").toBe(0);
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Activity" })).toHaveCount(0);
  await page.screenshot({ path: `${OUT_DIR}/dashboard-desktop.png`, fullPage: true });

  expect(errors.pageErrors, "no uncaught page errors").toEqual([]);
  expect(errors.consoleErrors, "no console errors").toEqual([]);
});

test("mobile dashboard renders and captures", async ({ page }) => {
  const errors = watchPage(page);
  await page.setViewportSize(MOBILE);
  await gotoDashboard(page);

  expect(await horizontalOverflow(page), "mobile should not scroll horizontally").toBe(0);
  await page.screenshot({ path: `${OUT_DIR}/dashboard-mobile.png`, fullPage: true });

  expect(errors.pageErrors, "no uncaught page errors").toEqual([]);
  expect(errors.consoleErrors, "no console errors").toEqual([]);
});

test("activity stats render when behavior data is present", async ({ page }) => {
  let playerId = "";
  await page.route("**/stats.json", async (route) => {
    const response = await route.fetch();
    const stats = (await response.json()) as { players: Record<string, unknown>; behavior?: unknown };
    const ids = Object.keys(stats.players).slice(0, 4);
    playerId = ids[0] ?? "";
    stats.behavior = {
      players: Object.fromEntries(ids.map((id, index) => [id, {
        matches: index === 0 ? 1 : 5,
        pings: 15 + index,
        pings_per_match: 3 + index,
        ping_bursts: 1,
        chat_messages: 2,
        chat_messages_per_match: 0.4,
        chatwheel: { "71": 2 },
        orders: 7200 + index * 100,
        orders_per_minute: 120 + index,
        wards_obs: 5,
        wards_sen: 10,
        wards_per_match: 3,
        runes: 4,
        runes_per_match: 0.8,
        pauses_initiated: 1,
        pause_seconds: 45,
      }])),
    };
    await route.fulfill({ response, json: stats });
  });

  const errors = watchPage(page);
  await page.setViewportSize(DESKTOP);
  await gotoDashboard(page);
  await expect(page.getByRole("heading", { name: "Lobby activity" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Highest order rate" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Activity" })).toHaveCount(1);
  await expect(page.getByText("Orders per minute are replay unit orders, not official APM.")).toBeVisible();
  await page.screenshot({ path: `${OUT_DIR}/activity-dashboard-desktop.png`, fullPage: true });

  expect(playerId, "mocked behavior data should include a player").toBeTruthy();
  await page.setViewportSize(MOBILE);
  await expectNoOverflow(page, "activity dashboard should not overflow on mobile");
  await page.screenshot({ path: `${OUT_DIR}/activity-dashboard-mobile.png`, fullPage: true });
  await page.setViewportSize(DESKTOP);
  await page.goto(`/player/${playerId}`);
  await expect(page.getByText("Orders / min", { exact: true })).toBeVisible();
  await expect(page.getByText("Averages use 1 recorded match.")).toBeVisible();
  await expect(page.getByText("Chat text is not displayed; only replay activity counts are included.")).toBeVisible();
  await page.screenshot({ path: `${OUT_DIR}/activity-player-desktop.png`, fullPage: true });
  await page.setViewportSize(MOBILE);
  await expectNoOverflow(page, "activity player profile should not overflow on mobile");
  await page.screenshot({ path: `${OUT_DIR}/activity-player-mobile.png`, fullPage: true });
  expect(errors.pageErrors, "no uncaught page errors").toEqual([]);
  expect(errors.consoleErrors, "no console errors").toEqual([]);
});

test("player profile renders and captures", async ({ page, request }) => {
  const statsResponse = await request.get("/stats.json");
  expect(statsResponse.ok(), "stats.json should be reachable").toBeTruthy();
  const stats = (await statsResponse.json()) as { players: Record<string, unknown> };
  const playerId = Object.keys(stats.players ?? {})[0];
  expect(playerId, "stats.json should contain at least one player").toBeTruthy();

  const errors = watchPage(page);
  await page.setViewportSize(DESKTOP);
  await page.goto(`/player/${playerId}`);
  await expect(page.getByRole("link", { name: /Back to dashboard/i })).toBeVisible();
  await expect(page.getByRole("alert"), "no connection-error card").toHaveCount(0);

  await page.screenshot({ path: `${OUT_DIR}/player-desktop.png`, fullPage: true });

  expect(errors.pageErrors, "no uncaught page errors").toEqual([]);
  expect(errors.consoleErrors, "no console errors").toEqual([]);
});
