import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for Advantage Foundry.
 *
 * Tests run against the live deployment by default, or against
 * a local dev server if BASE_URL env var is set.
 *
 * Usage:
 *   npx playwright test              # run all tests
 *   npx playwright test --headed     # run with visible browser
 *   npx playwright test --reporter=html  # generate HTML report
 */
const BASE_URL = process.env.BASE_URL || "https://microsoft-mailbox-automation-one.vercel.app";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  reporter: [
    ["list"],
    ["html", { outputDir: "test-results/html" }],
    ["json", { outputFile: "test-results/results.json" }],
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        channel: "chrome", // Use system Chrome instead of downloading
      },
    },
  ],
});
