import { defineConfig } from "@playwright/test";

// UI verification runs against the built SPA served by `vite preview`.
// `channel: "chrome"` uses the system Google Chrome, so no bundled browser
// download is required. Screenshots and console/network checks live in tests/.
const PORT = Number(process.env.UI_PORT ?? 4173);
const BASE_URL = process.env.UI_BASE_URL ?? `http://localhost:${PORT}`;
// When UI_BASE_URL points at a remote host (e.g. the live site), do not start a
// local preview server — run the same assertions and screenshots against it.
const IS_LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(BASE_URL);

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: "list",
  timeout: 30_000,
  use: {
    baseURL: BASE_URL,
    channel: "chrome",
    headless: true,
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
