import { test, expect } from "@playwright/test";

test("match insight expands grounded winning and improvement sections", async ({ page }) => {
  test.skip(!process.env.VITE_AI_API_URL, "Build with VITE_AI_API_URL to exercise the optional analysis UI.");
  await page.route("**/matches.json", (route) => route.fulfill({ json: { match_count: 1, matches: [{ match_id: "123", duration: 1200, start_time: 1700000000, radiant_win: true, players: [
    { account_id: "1", player_name: "Player", hero_id: 25, hero_name: "Lina", team: "radiant", win: true, kills: 4, deaths: 1, assists: 3 },
    { account_id: "2", player_name: "Opponent", hero_id: 48, hero_name: "Luna", team: "dire", win: false, kills: 1, deaths: 4, assists: 0 },
  ] }] } }));
  await page.route("**/matches/123/insight", (route) => route.fulfill({ json: { insight: { summary: "Radiant led 4–1 at 792 seconds.", winning_factors: [{ category: "economy", title: "Economy", text: "Lina led after 323 seconds.", time_seconds: 792 }], losing_challenges: [{ category: "death", title: "Deaths", text: "Dire lost one hero.", time_seconds: 0 }], improvements: [{ category: "defense", title: "Survival", text: "Review the fights around Lina.", time_seconds: null }], limitations: "0s (unknown timestamp) for an item." }, cached: false } }));
  await page.goto("/matches/123");
  await expect(page.getByRole("heading", { name: "Match insight" })).toBeVisible();
  await page.getByRole("button", { name: "Generate insight" }).click();
  await expect(page.getByText("Radiant led 4–1 at 13:12.")).toBeVisible();
  await page.getByRole("button", { name: "Read analysis" }).click();
  await expect(page.getByRole("heading", { name: "Why Radiant won" })).toBeVisible();
  await expect(page.getByText("Review the fights around Lina.")).toBeVisible();
  await expect(page.getByText("Lina led after 5:23.")).toBeVisible();
  await expect(page.getByText("0:00", { exact: true })).toBeVisible();
  await expect(page.getByText("time unavailable for an item.")).toBeVisible();
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.getByRole("heading", { name: "Match insight" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector(".match-insight")!.getBoundingClientRect().right <= window.innerWidth + 1)).toBeTruthy();
});
