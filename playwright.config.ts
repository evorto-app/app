import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env['CI'],
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Configure projects for major browsers */
  projects: [
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts$/,
    },
    {
      dependencies: ['setup'],
      name: 'docs',
      testMatch: /.*\.doc\.ts$/,
      timeout: 20 * 1000,
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
    {
      dependencies: ['setup'],
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },

    {
      dependencies: ['setup'],
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },

    {
      dependencies: ['setup'],
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },

    /* Test against mobile viewports. */
    {
      dependencies: ['setup'],
      name: 'Mobile Chrome',
      use: { ...devices['Pixel 7'] },
    },
    {
      dependencies: ['setup'],
      name: 'Mobile Safari',
      use: { ...devices['iPhone 14'] },
    },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: process.env['CI']
    ? [['github'], ['dot']]
    : [['html'], ['./e2e/reporters/documentation-reporter.ts'], ['dot']],
  /* Retry on CI only */
  retries: process.env['CI'] ? 2 : 0,
  testDir: './e2e',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env['PLAYWRIGHT_TEST_BASE_URL'] ?? 'http://localhost:4200',

    colorScheme: 'light',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  webServer: {
    command: 'yarn docker:start-test',
    reuseExistingServer: true,
    url: 'http://localhost:4200',
  },

  /* Opt out of parallel tests on CI. */
  ...(process.env['CI'] ? { workers: 1 } : {}),
});
