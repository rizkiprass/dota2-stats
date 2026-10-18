import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, ".", "VITE_");
  const statsOrigin = env.VITE_STATS_ORIGIN || "https://dls.rpras.my.id";
  const statsProxy = {
    "/stats.json": { target: statsOrigin, changeOrigin: true },
    "/matches.json": { target: statsOrigin, changeOrigin: true },
  };

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: statsProxy,
    },
    // Playwright uses vite preview, so it needs the same data proxy as local development.
    preview: {
      proxy: statsProxy,
    },
    build: {
      outDir: "dist",
      sourcemap: false,
    },
  };
});
