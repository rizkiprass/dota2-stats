import posthog from "posthog-js";

// Vite embeds these public values at build time. Never use a personal API key.
export function initializeAnalytics() {
  const token = import.meta.env.VITE_POSTHOG_KEY;
  const host = import.meta.env.VITE_POSTHOG_HOST;

  if (!import.meta.env.PROD || !token || !host) return;

  posthog.init(token, {
    api_host: host,
    capture_pageview: "history_change",
    capture_pageleave: false,
    autocapture: false,
    capture_dead_clicks: false,
    disable_session_recording: true,
  });
}
