import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// Screenshots land here by default so `visual-reviewer` can pick them up by path.
const OUT_DIR = process.env.UI_SHOT_DIR ?? "/tmp/opencode/shots";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 360, height: 800 };

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

/**
 * Open the page and report whether the calendar rendered. The per-match payload
 * is optional per deployment, so tests that need it say so instead of failing.
 */
async function gotoMatches(page: Page): Promise<boolean> {
  const statsLoaded = page.waitForResponse((r) => r.url().endsWith("/stats.json") && r.status() === 200);
  await page.goto("/matches", { waitUntil: "domcontentloaded" });
  await statsLoaded;
  await expect(page.getByRole("heading", { level: 1, name: "Match history" })).toBeVisible();
  await page.waitForSelector(".mh-card, .empty-state");
  return (await page.locator(".mh-card").count()) > 0;
}

interface GridReport {
  checked: number;
  expectedDays: number;
  problems: string[];
}

/** Validate every rendered day against its real weekday, in the browser. */
async function readGrid(page: Page): Promise<GridReport> {
  const label = await page.locator(".mh-month-label").innerText();
  return page.evaluate((monthLabel: string) => {
    const MONTHS = [
      "January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December",
    ];
    const [name, yearText] = monthLabel.split(" ");
    const month = MONTHS.indexOf(name);
    const year = Number(yearText);
    const rows = [...document.querySelectorAll(".cal tbody tr")];
    const problems: string[] = [];
    let checked = 0;

    rows.forEach((row) =>
      [...row.querySelectorAll("td")].forEach((cell, column) => {
        const text = cell.querySelector(".cal-day .cal-num")?.textContent?.trim() ?? "";
        if (!text) return;
        const day = Number(text);
        // Columns are Monday-first.
        const expected = (new Date(year, month, day).getDay() + 6) % 7;
        checked += 1;
        if (expected !== column) problems.push(`day ${day} in column ${column}, expected ${expected}`);
      }),
    );

    // Day 0 of the next month is the last day of this one.
    return { checked, expectedDays: new Date(year, month + 1, 0).getDate(), problems };
  }, label);
}

test("the calendar puts every day under its real weekday", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  if (!(await gotoMatches(page))) {
    await expect(page.locator(".empty-state")).toContainText(/Per-match history isn.t published/);
    return;
  }

  // A single off-by-one silently shifts the whole grid, so check the month we
  // open on, plus the next one when it exists.
  let validated = 0;
  while (validated < 2) {
    const report = await readGrid(page);
    expect(report.problems, "every day must sit in its own weekday column").toEqual([]);
    expect(report.checked, "the grid must render exactly this month's days").toBe(report.expectedDays);
    validated += 1;
    if (await page.getByLabel("Next month").isDisabled()) break;
    await page.getByLabel("Next month").click();
    await page.waitForTimeout(150);
  }
  expect(validated).toBeGreaterThan(0);
});

test("days with matches are marked and filter the list", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  if (!(await gotoMatches(page))) return;

  const marked = page.locator(".cal-day.has-matches");
  const markedDays = await marked.count();
  if (markedDays === 0) {
    await expect(page.locator("text=No matches recorded in this month.")).toBeVisible();
    return;
  }

  const cardsBefore = await page.locator(".match-card").count();
  expect(cardsBefore).toBeGreaterThan(0);

  const day = marked.first();
  const label = await day.getAttribute("aria-label");
  await day.click();
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".mh-filter")).toContainText("Showing one day");

  const cardsAfter = await page.locator(".match-card").count();
  expect(cardsAfter, "filtering to one day cannot add matches").toBeLessThanOrEqual(cardsBefore);
  expect(label).toMatch(/^\d+, \d+ match/);

  await page.locator(".mh-filter .board-toggle").click();
  await expect(page.locator(".mh-filter")).toHaveCount(0);
  expect(await page.locator(".match-card").count()).toBe(cardsBefore);
});

test("a match card reveals the K/D/A only when expanded", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  if (!(await gotoMatches(page))) return;

  const card = page.locator(".match-card").first();
  const head = card.locator(".mc-head");
  await expect(head).toHaveAttribute("aria-expanded", "false");
  expect(await card.locator(".dp-hero-val").count(), "K/D/A starts hidden").toBe(0);
  expect(await card.locator(".mc-side").first().locator(".dp-hero-row").count(), "five heroes per side").toBe(5);

  await head.click();
  await expect(head).toHaveAttribute("aria-expanded", "true");
  expect(await card.locator(".dp-hero-val").count(), "ten players once expanded").toBe(10);
  await expect(card.locator(".dp-hero-val").first()).toHaveText(/^\d+\/\d+\/\d+$/);
});

test("month navigation is bounded by the published range", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  if (!(await gotoMatches(page))) return;

  // Walk forward to the current month, where Next must switch off.
  const next = page.getByLabel("Next month");
  for (let step = 0; step < 60 && !(await next.isDisabled()); step += 1) {
    await next.click();
    await page.waitForTimeout(60);
  }
  await expect(next, "Next must stop at the current month").toBeDisabled();

  // Walking back must re-enable it, and Prev stops at the earliest match.
  await page.getByLabel("Previous month").click();
  await expect(next).toBeEnabled();
});

test("the dashboard nav reaches match history", async ({ page }) => {
  await page.setViewportSize(DESKTOP);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#leaderboards");

  const nav = page.getByRole("navigation", { name: "Sections" });
  await nav.getByRole("link", { name: "History" }).click();
  await expect(page).toHaveURL(/\/matches$/);
  await expect(page.getByRole("heading", { level: 1, name: "Match history" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "History" })).toHaveClass(/active/);
});

test("match history stacks on mobile without overflow", async ({ page }) => {
  await page.setViewportSize(MOBILE);
  await gotoMatches(page);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "match history should not scroll horizontally").toBe(0);
  await page.screenshot({ path: `${OUT_DIR}/matches-mobile.png`, fullPage: true });
});
