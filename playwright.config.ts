import { defineConfig } from "@playwright/test";

// Uji responsive (2026-11-05). Dijalankan terpisah dari `npm test` (unit kritis),
// butuh dev server di BASE_URL (default 127.0.0.1:3300) + DB TIRUAN (lihat tests/e2e/seed-rtest.ts).
export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 600000,
  reporter: "line",
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:3300",
    headless: true,
  },
});
