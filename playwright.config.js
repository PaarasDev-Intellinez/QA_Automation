
// @ts-check
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({

  // Location of our test files
  testDir: './tests',

  // Execute tests sequentially for now
  fullyParallel: false,
  workers: 1,

  // Retry failed tests only in CI
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  // Generate HTML reports
  reporter: 'html',

  // Common browser settings
  use: {
    baseURL: 'https://admin.practicelink.com',

    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },

  // Start with Chromium only
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
