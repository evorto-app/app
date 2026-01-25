import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const webServer = process.env['NO_WEBSERVER']
  ? undefined
  : ({
      command: 'yarn docker:start-test',
      reuseExistingServer: true,
      timeout: 240_000,
      url: 'http://localhost:4200',
    } as const);

const globalTimeout = process.env['PLAYWRIGHT_GLOBAL_TIMEOUT']
  ? Number(process.env['PLAYWRIGHT_GLOBAL_TIMEOUT'])
  : undefined;
const grep = process.env['PLAYWRIGHT_GREP']
  ? new RegExp(process.env['PLAYWRIGHT_GREP'])
  : undefined;
const workers = process.env['PLAYWRIGHT_WORKERS']
  ? Number(process.env['PLAYWRIGHT_WORKERS'])
  : undefined;

// Configure reporters: avoid blocking HTML server opening; prefer terminal output
const reporters: any[] = [];
if (process.env['CI']) {
  reporters.push(['github'], ['dot']);
} else {
  // Local: never auto-open HTML report; still generate artifacts
  reporters.push(
    ['html', { open: 'never' }],
    ['dot'],
    ['./e2e/reporters/documentation-reporter.ts'],
  );
}

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
      use: { ...devices['Desktop Chrome'] },
    },
    {
      dependencies: ['setup'],
      name: 'docs',
      testMatch: /.*\.doc\.ts$/,
      timeout: 20 * 1000,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      dependencies: ['setup'],
      name: 'local-chrome',
      use: { ...devices['Desktop Chrome'] },
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
  reporter: reporters,
  /* Retry on CI only */
  retries: process.env['CI'] ? 2 : 0,
  ...(workers ? { workers } : {}),
  testDir: './e2e',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: process.env['PLAYWRIGHT_TEST_BASE_URL'] ?? 'http://localhost:4200',

    colorScheme: 'light',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',

    /* Ignore SSL errors when connecting to Auth0 and other external services */
    ignoreHTTPSErrors: true,
  },

  ...(webServer ? { webServer } : {}),
  ...(globalTimeout ? { globalTimeout } : {}),
  ...(grep ? { grep } : {}),
  ...(workers ? { workers } : {}),

  /* Opt out of parallel tests on CI. */
  // ...(process.env['CI'] ? { workers: 1 } : {}),
});
