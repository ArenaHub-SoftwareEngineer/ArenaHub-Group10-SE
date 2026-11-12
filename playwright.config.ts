import { defineConfig, devices } from '@playwright/test';

// Browser checks run against the disposable demo-arenahub emulators only.
// Start them through `npm run test:e2e`, which seeds the QA accounts first.
export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5176',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'mobile-375', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 } } },
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: {
    command: 'npx vite --mode test --port 5176 --host 127.0.0.1 --strictPort',
    url: 'http://127.0.0.1:5176',
    reuseExistingServer: true,
    timeout: 120_000,
    // Browser tests must never write into the event laptop's real match monitor database.
    env: { INTEGRITY_DATA_DIR: 'test-results/integrity-data' },
  },
});
