import {defineConfig} from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    browserName: 'chromium',
    headless: true,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm start',
      url: 'http://127.0.0.1:4400/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: {
        PORT: '4400',
        DB_PATH: './.actionledger-browser.sqlite',
        RECEIPT_SECRET: 'local-ci-only-receipt-signing-secret',
      },
    },
    {
      command: 'npm run dev --prefix web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
