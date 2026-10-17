import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Screenshots land here by default so `visual-reviewer` can pick them up by path.
const OUT_DIR = process.env.UI_SHOT_DIR ?? "/tmp/opencode/shots";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 360, height: 800 };

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

async function gotoHeroes(page: Page): Promise<void> {
  const statsLoaded = page.waitForResponse((r) => r.url().endsWith("/stats.json") && r.status() === 200);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await statsLoaded;
  await expect(page.locator("#heroes")).toBeVisible();
  await page.locator("#heroes").scrollIntoViewIfNeeded();
}

test("hero distribution renders a donut with a grouped tail", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoHeroes(page);

  const donut = page.locator(".hd-donut");
  await expect(donut).toBeVisible();

  // Accessible name summarises the same numbers shown as text.
  const svg = donut.locator("svg");
  await expect(svg).toHaveAttribute("role", "img");
  const label = await svg.getAttribute("aria-label");
  expect(label, "the chart needs a text alternative").toMatch(/Hero pick distribution across \d+ picks/);

  const legend = page.locator(".hd-legend-row");
  const rows = await legend.count();
  expect(rows, "at most five named heroes plus a grouped tail").toBeLessThanOrEqual(6);
  expect(await page.locator(".hd-slice").count(), "one arc per legend row").toBe(rows);

  // The tail is grouped, never one arc per hero.
  const last = legend.last();
  if (rows === 6) await expect(last.locator(".hd-legend-name")).toContainText(/other heroes/);

  // Shares must add up.
  const shares = await legend.locator(".hd-legend-val").allInnerTexts();
  const total = shares.reduce((sum, text) => sum + Number(text.match(/([\d.]+)%/)?.[1] ?? 0), 0);
  expect(total).toBeGreaterThan(99.5);
  expect(total).toBeLessThan(100.5);

  // The centre label is the pick total from the payload.
  await expect(page.locator(".hd-center-value")).toHaveText(/\d+/);
});

test("a hero keeps one tint across the chart and the grid", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoHeroes(page);

  const firstSwatch = page.locator(".hd-swatch").first();
  const firstTile = page.locator(".hero-grid .hero-tile").first();
  const swatchVar = await firstSwatch.evaluate((el) => (el as HTMLElement).style.background);
  const tileVar = await firstTile.evaluate((el) => el.style.getPropertyValue("--tile-accent"));

  expect(swatchVar).toMatch(/var\(--av[1-6]\)/);
  expect(tileVar, "the grid and the donut must agree on a hero's color").toBe(swatchVar);
});

test("contested heroes render, or explain their absence", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await gotoHeroes(page);

  const blocked = page.locator(".hd-contested-block");
  await expect(blocked).toBeVisible();
  await expect(blocked.getByRole("heading", { name: "Contested heroes" })).toBeVisible();

  const rows = await blocked.locator(".dp-hero-row").count();
  if (rows === 0) {
    await expect(blocked).toContainText(/No hero has been picked by both teams/);
  } else {
    await expect(blocked).toContainText(/picked by both teams in \d+ match/);
  }
});

test("heroes section stacks on mobile without overflow", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await gotoHeroes(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "heroes section should not scroll horizontally").toBe(0);
  await expect(page.locator(".hd-donut")).toBeVisible();

  await page.locator("#heroes").scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT_DIR}/heroes-mobile.png` });
});
