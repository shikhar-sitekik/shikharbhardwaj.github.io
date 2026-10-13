import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";

const env = config({ path: ".env.e2e" }).parsed ?? {};
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (process.env.CI ? undefined : "/opt/pw-browsers/chromium");

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    // Requires `npm run build` first (CI does this in the check step).
    command: "npx next start -p 3100",
    url: "http://localhost:3100/api/health",
    reuseExistingServer: false,
    timeout: 60_000,
    env: { ...env, NODE_ENV: "production" },
  },
});
