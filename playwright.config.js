import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  retries: 0,
  reporter: 'list',
  fullyParallel: false,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 800 },
    // Force a consistent device pixel ratio so snapshot bytes are stable.
    deviceScaleFactor: 1,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node tools/server.js',
    port: 4173,
    reuseExistingServer: true,
    timeout: 10_000,
  },
});
