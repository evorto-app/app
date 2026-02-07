import { defineConfig, devices } from '@playwright/test';
import { validatePlaywrightEnvironment } from './tests/support/config/environment';

const environment = validatePlaywrightEnvironment();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const webServer = environment.NO_WEBSERVER
  ? undefined
  : ({
      command: 'yarn docker:start-test',
      reuseExistingServer: true,
      timeout: 240_000,
      url: 'http://localhost:4200',
    } as const);

// Configure reporters: avoid blocking HTML server opening; prefer terminal output
const reporters: any[] = [];
if (environment.CI) {
  reporters.push(['github'], ['dot']);
} else {
  // Local: never auto-open HTML report; still generate artifacts
  reporters.push(
    ['html', { open: 'never' }],
    ['dot'],
    ['./tests/support/reporters/documentation-reporter.ts'],
  );
}

export default defineConfig({
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!environment.CI,
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Configure projects for major browsers */
  projects: [
    {
      name: 'setup',
      testDir: './tests/setup',
      testMatch: /.*\.setup\.ts$/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      dependencies: ['setup'],
      name: 'docs',
      testMatch: /docs\/.*\.doc\.ts$/,
      timeout: 60 * 1000,
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
    {
      dependencies: ['setup'],
      name: 'local-chrome',
      testIgnore: /docs\/.*\.doc\.ts$/,
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
    // {
    //   dependencies: ['setup'],
    //   name: 'chromium',
    //   use: { ...devices['Desktop Chrome'] },
    // },
    //
    // {
    //   dependencies: ['setup'],
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    //
    // {
    //   dependencies: ['setup'],
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   dependencies: ['setup'],
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 7'] },
    // },
    // {
    //   dependencies: ['setup'],
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 14'] },
    // },

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
  retries: environment.CI ? 2 : 0,
  testDir: './tests',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL:
      environment.PLAYWRIGHT_TEST_BASE_URL ?? 'http://localhost:4200',

    colorScheme: 'light',

    /* Ignore SSL errors when connecting to Auth0 and other external services */
    ignoreHTTPSErrors: true,

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'on-first-retry',
  },

  ...(webServer ? { webServer } : {}),

  /* Opt out of parallel tests on CI. */
  // ...(process.env['CI'] ? { workers: 1 } : {}),
});
