import { defineConfig, devices } from "@playwright/test";

const chrome = devices["Desktop Chrome"];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  use: {
    baseURL: "http://127.0.0.1:3100",
    colorScheme: "light",
    locale: "es-ES",
    screenshot: "only-on-failure",
    timezoneId: "Europe/Madrid",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "mobile-390x844",
      use: {
        ...chrome,
        hasTouch: true,
        isMobile: true,
        viewport: { width: 390, height: 844 },
      },
    },
    {
      name: "tablet-768x1024",
      use: {
        ...chrome,
        hasTouch: true,
        isMobile: true,
        viewport: { width: 768, height: 1024 },
      },
    },
    {
      name: "desktop-1280x720",
      use: {
        ...chrome,
        viewport: { width: 1280, height: 720 },
      },
    },
  ],
  webServer: {
    command: "npm run start:e2e",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer:
      process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true",
    timeout: 300_000,
  },
});
