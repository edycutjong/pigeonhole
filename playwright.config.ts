import { defineConfig, devices } from "@playwright/test";

// E2E runs against the production bundle (`vite preview` serves dist/), exactly what GitHub Pages serves.
// No wallet, no keys: every test is read-only against Arc mainnet's public RPC, and the RPC-dependent
// assertions skip themselves when the runner cannot reach it.
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // the live specs share one public RPC; parallel browsers trip its rate limit
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chrome", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run build && npm run preview",
    url: "http://localhost:4173",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
