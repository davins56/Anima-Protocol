import { defineConfig, devices } from "@playwright/test";

// The Anima frontend talks to the API server through the SAME origin
// (`${window.location.origin}/api/store`). On Replit, only the dev proxy
// domain routes BOTH `/` (Vite) and `/api` (api-server) correctly, so the
// e2e suite must run against that domain — never localhost. Override with
// E2E_BASE_URL in CI.
const devDomain = process.env.REPLIT_DEV_DOMAIN;
const baseURL =
  process.env.E2E_BASE_URL ||
  (devDomain ? `https://${devDomain}` : "http://localhost:5000");

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.spec\.ts/,
  // Cross-device flows involve real network + async per-account seeding, so
  // give each test generous headroom.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  // Tests share Clerk test users created in beforeAll; keep them serial.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL,
    actionTimeout: 20_000,
    navigationTimeout: 45_000,
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
