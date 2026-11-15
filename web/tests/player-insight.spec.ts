import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";

// The card is the only place in the dashboard that can spend provider tokens, so
// these tests assert on what does NOT happen as much as on what does: a page view
// must never POST, and an ineligible player must never be offered a generation
// that the server would refuse anyway.

const OUT_DIR = process.env.UI_SHOT_DIR ?? "/tmp/opencode/shots";
const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 360, height: 800 };
const PROFILE_URL = /\/players\/[^/]+\/profile/;
// One published match, older than every "fresh" meta below and newer than the
// stale case's generated_at, so staleness is decided by fixture data rather than
// by whatever the live dashboard happens to hold today.
const MATCH_TIME = 1_600_000_000;

const PROFILE = {
  headline: "A 612 GPM record across 20 recent matches.",
  strengths: [{ title: "Farm", text: "Averaged 612 gold per minute.", metrics: ["gpm"] }],
  focus_areas: [{ title: "Deaths", text: "Averaged 4.1 deaths per match.", metrics: ["deaths"] }],
  role_read: { text: "The inferred role is carry, at sufficient confidence.", metrics: ["role.confidence"] },
  trend: { direction: "improving", text: "Gold per minute rose between the two halves.", metrics: ["trends.gpm"] },
  limitations: "Ward placement and map control are not recorded in this dataset.",
};

const meta = (generatedAt: number, overrides: Record<string, unknown> = {}) => ({
  metrics_version: "1.0.0",
  prompt_version: "1",
  model: "google/gemini-2.5-flash",
  source_hash: "abc123",
  matches_analyzed: 20,
  sample_tier: "adequate",
  confidence: "medium",
  generated_at: generatedAt,
  ...overrides,
});

interface Answer { status: number; body: unknown }
interface Calls { get: number; post: number }
interface Case { name: string; stored: Answer; generated?: Answer; assert(page: Page, calls: Calls): Promise<void> }

const NOT_GENERATED: Answer = { status: 404, body: { message: "No analysis has been generated for this player yet.", status: "not_generated" } };
const INSUFFICIENT: Answer = {
  status: 200,
  body: {
    status: "insufficient_data",
    message: "At least 5 eligible private-lobby matches are needed; 3 were found.",
    matches_analyzed: 3,
    required_matches: 5,
  },
};
const stored = (generatedAt: number, overrides: Record<string, unknown> = {}): Answer => ({
  status: 200,
  body: { profile: PROFILE, meta: meta(generatedAt, overrides), cached: true },
});
const generated = (generatedAt: number, extra: Record<string, unknown> = {}): Answer => ({
  status: 200,
  body: { profile: PROFILE, meta: meta(generatedAt), cached: false, regenerated: false, stored: true, ...extra },
});

/** Route the profile endpoint and count how often each verb was used. */
async function stubProfile(page: Page, answer: Answer, onPost: Answer = answer): Promise<Calls> {
  const calls = { get: 0, post: 0 };
  await page.route(PROFILE_URL, (route) => {
    const method = route.request().method();
    if (method === "GET") calls.get += 1;
    if (method === "POST") calls.post += 1;
    const reply = method === "POST" ? onPost : answer;
    void route.fulfill({ status: reply.status, contentType: "application/json", body: JSON.stringify(reply.body) });
  });
  return calls;
}

async function openProfile(page: Page): Promise<string> {
  const response = await page.request.get("/stats.json");
  expect(response.ok(), "stats.json should be reachable").toBeTruthy();
  const stats = (await response.json()) as { players: Record<string, unknown> };
  const id = Object.keys(stats.players ?? {})[0];
  expect(id, "stats.json should contain at least one player").toBeTruthy();
  await page.route("**/matches.json", (route) =>
    route.fulfill({
      json: {
        match_count: 1,
        matches: [{
          match_id: "123", duration: 1800, start_time: MATCH_TIME, radiant_win: true,
          players: [{ account_id: id, player_name: "Player", hero_id: 25, hero_name: "Lina", team: "radiant", win: true, kills: 4, deaths: 1, assists: 3 }],
        }],
      },
    }),
  );
  await page.setViewportSize(DESKTOP);
  await page.goto(`/player/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Player read" })).toBeVisible();
  return id;
}

const CASES: Case[] = [
  {
    name: "a page view shows a stored analysis without generating one",
    stored: stored(MATCH_TIME + 1000),
    async assert(page, calls) {
      await expect(page.getByText(PROFILE.headline)).toBeVisible();
      // The collapsed card shows only the headline; the details need one click.
      await expect(page.getByText(PROFILE.strengths[0].text)).toHaveCount(0);
      await page.getByRole("button", { name: "Read analysis" }).click();
      await expect(page.getByRole("heading", { name: "Strengths" })).toBeVisible();
      await expect(page.getByText(PROFILE.strengths[0].text)).toBeVisible();
      await expect(page.getByText(PROFILE.focus_areas[0].text)).toBeVisible();
      await expect(page.getByText(PROFILE.role_read.text)).toBeVisible();
      await expect(page.getByText("Improving")).toBeVisible();
      await expect(page.getByText(PROFILE.limitations)).toBeVisible();
      await expect(page.getByText("Based on 20 recent matches")).toBeVisible();
      await expect(page.getByText("Medium confidence · AI interpretation")).toBeVisible();
      expect(calls.post, "a page view must never POST").toBe(0);
      expect(calls.get, "the stored analysis is read on mount").toBeGreaterThan(0);
    },
  },
  {
    name: "an analysis with nothing stored offers to generate one",
    stored: NOT_GENERATED,
    async assert(page, calls) {
      await expect(page.getByRole("button", { name: "Generate analysis" })).toBeVisible();
      await expect(page.getByText(/never from chat or behaviour data/)).toBeVisible();
      // "Nothing stored yet" is the normal first visit, not a failure.
      await expect(page.getByRole("alert")).toHaveCount(0);
      await expect(page.getByText("Based on")).toHaveCount(0);
      expect(calls.post, "a missing analysis must not be generated automatically").toBe(0);
    },
  },
  {
    name: "generating on demand renders the answer expanded",
    stored: NOT_GENERATED,
    generated: generated(MATCH_TIME + 1000),
    async assert(page, calls) {
      await page.getByRole("button", { name: "Generate analysis" }).click();
      await expect(page.getByText(PROFILE.headline)).toBeVisible();
      await expect(page.getByRole("heading", { name: "Focus areas" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Show less" })).toBeVisible();
      expect(calls.post).toBe(1);
    },
  },
  {
    name: "an ineligible sample is explained and offers no generation",
    stored: NOT_GENERATED,
    generated: INSUFFICIENT,
    async assert(page, calls) {
      await page.getByRole("button", { name: "Generate analysis" }).click();
      await expect(page.getByText("At least 5 eligible private-lobby matches are needed; 3 were found.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Generate analysis" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Regenerate" })).toHaveCount(0);
      await expect(page.getByRole("alert")).toHaveCount(0);
      expect(calls.post).toBe(1);
    },
  },
  {
    name: "a rate limit is reported as an error, not a silent failure",
    stored: NOT_GENERATED,
    generated: { status: 429, body: { message: "Analysis limit reached. Please try again later." } },
    async assert(page) {
      await page.getByRole("button", { name: "Generate analysis" }).click();
      await expect(page.getByRole("alert")).toHaveText("Analysis limit reached. Please try again later.");
      // The card stays usable: the button is still there once the hour rolls over.
      await expect(page.getByRole("button", { name: "Generate analysis" })).toBeVisible();
    },
  },
  {
    name: "an analysis older than the newest match is marked stale",
    stored: stored(MATCH_TIME - 1000),
    async assert(page) {
      await expect(page.getByText("Matches have been published since this analysis was generated.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Refresh analysis" })).toBeVisible();
    },
  },
  {
    name: "a small sample is labelled as one",
    stored: stored(MATCH_TIME + 1000, { matches_analyzed: 6, sample_tier: "small", confidence: "low" }),
    async assert(page) {
      await expect(page.getByText(/Small sample: 6 matches/)).toBeVisible();
      await expect(page.getByText("Low confidence · AI interpretation")).toBeVisible();
    },
  },
  {
    name: "an unsaved analysis says it will be generated again",
    stored: NOT_GENERATED,
    generated: generated(MATCH_TIME + 1000, { stored: false }),
    async assert(page) {
      await page.getByRole("button", { name: "Generate analysis" }).click();
      await expect(page.getByText(PROFILE.headline)).toBeVisible();
      await expect(page.getByText(/could not be saved/)).toBeVisible();
    },
  },
];

test.beforeAll(() => {
  mkdirSync(OUT_DIR, { recursive: true });
});

for (const spec of CASES) {
  test(spec.name, async ({ page }) => {
    test.skip(!process.env.VITE_AI_API_URL, "Build with VITE_AI_API_URL to exercise the optional analysis UI.");
    const calls = await stubProfile(page, spec.stored, spec.generated);
    await openProfile(page);
    await spec.assert(page, calls);
  });
}

test("the player read card fits a narrow viewport", async ({ page }) => {
  test.skip(!process.env.VITE_AI_API_URL, "Build with VITE_AI_API_URL to exercise the optional analysis UI.");
  await stubProfile(page, stored(MATCH_TIME + 1000));
  await openProfile(page);
  await page.getByRole("button", { name: "Read analysis" }).click();
  await expect(page.getByRole("heading", { name: "Strengths" })).toBeVisible();
  await page.locator(".player-insight").screenshot({ path: `${OUT_DIR}/player-insight-desktop.png` });

  await page.setViewportSize(MOBILE);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), {
      timeout: 5_000,
      message: "the player read card should not overflow on mobile",
    })
    .toBe(0);
  await page.locator(".player-insight").screenshot({ path: `${OUT_DIR}/player-insight-mobile.png` });
});
