const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:8138',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: {
    ...devices['Desktop Chrome'],
    ...(process.env.BUDGET_E2E_CHANNEL ? { channel: process.env.BUDGET_E2E_CHANNEL } : {}),
  } }],
  webServer: {
    command: 'node tests/e2e/server.cjs',
    url: 'http://127.0.0.1:8138/free/',
    reuseExistingServer: false,
  },
});
