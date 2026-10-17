import { defineConfig } from "@playwright/test";

// UI verification runs against the built SPA served by `vite preview`.
// `channel: "chrome"` uses the system Google Chrome, so no bundled browser
// download is required. Screenshots and console/network checks live in tests/.
const PORT = Number(process.env.UI_PORT ?? 4173);
const BASE_URL = process.env.UI_BASE_URL ?? `http://localhost:${PORT}`;
// When UI_BASE_URL points at a remote host (e.g. the live site), do not start a
// local preview server — run the same assertions and screenshots against it.
const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE_URL);
// Default to Playwright's bundled full Chromium (installed via
// `npx playwright install chromium`), which handles full-page screenshots. Set
// PW_CHANNEL=chrome to use a system Google Chrome instead.
const CHANNEL = process.env.PW_CHANNEL ?? "chromium";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  // The workspace can live on a slow mounted filesystem (e.g. WSL /mnt/d), so
  // give the browser events more headroom than Playwright's 30s default.
  timeout: 60_000,
  // Cap parallel browsers; many headless Chromium instances starve each other on
  // a shared laptop (worse on a slow mounted filesystem). Override with PW_WORKERS.
  workers: process.env.PW_WORKERS ? Number(process.env.PW_WORKERS) : 2,
  use: {
    baseURL: BASE_URL,
    headless: true,
    channel: CHANNEL,
  },
  webServer: IS_LOCAL
    ? {
        command: `npm run preview -- --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: !process.env.CI,
        timeout: 30_000,
      }
    : undefined,
});
