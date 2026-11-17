import { defineConfig, devices } from 'playwright/test';

// Deliberately no production baseURL override: this suite must never resync providers.
export default defineConfig({
  testDir: './e2e', fullyParallel: true, forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0, workers: 2,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://127.0.0.1:4173', launchOptions: { chromiumSandbox: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}) }, trace: 'retain-on-failure', screenshot: 'only-on-failure', serviceWorkers: 'block' },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] } },
    // Chromium portrait emulation, not physical iPhone or Safari coverage.
    { name: 'iphone17-portrait-chromium', use: { ...devices['iPhone 17'], browserName: 'chromium' } },
  ],
  webServer: { command: 'bun e2e/serve.mjs', url: 'http://127.0.0.1:4173', reuseExistingServer: false },
});
