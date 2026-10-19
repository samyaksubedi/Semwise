import { defineConfig, devices } from "@playwright/test";
import { API_DIR, WEB_DIR, apiEnv } from "./e2e/support/env";

/**
 * Browser tests: one worker, Chromium only, against production builds (`pnpm build` first; the
 * root `pnpm e2e` does both). The compiled API and worker talk to the local Docker services and
 * a fake OpenAI server; the demo college is recreated before every run. See docs/local-setup.md.
 */
const env = apiEnv();

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/support/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "./e2e/results",
  use: {
    ...devices["Desktop Chrome"],
    // Phones come first: the tests run at a phone's width, with a mouse.
    viewport: { width: 390, height: 844 },
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium" }],
  webServer: [
    {
      name: "api",
      command: "node dist/server.js",
      cwd: API_DIR,
      env,
      url: "http://localhost:4000/v1/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      name: "worker",
      command: "node dist/worker.js",
      cwd: API_DIR,
      env,
      wait: { stdout: /Worker started/ },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      name: "web",
      command: "node node_modules/next/dist/bin/next start --port 3000",
      cwd: WEB_DIR,
      url: "http://localhost:3000/login",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
