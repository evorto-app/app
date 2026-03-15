import { defineConfig, devices } from '@playwright/test';
import { ConfigError, ConfigProvider, Effect } from 'effect';

import { formatConfigError } from './src/server/config/config-error';
import { playwrightEnvironmentConfig } from './tests/support/config/environment';

const environment = Effect.runSync(
  playwrightEnvironmentConfig.pipe(
    Effect.withConfigProvider(ConfigProvider.fromEnv()),
    Effect.mapError(
      (error: ConfigError.ConfigError) =>
        new Error(
          `Invalid Playwright e2e configuration:\n${formatConfigError(error)}`,
        ),
    ),
  ),
);
const resolvedBaseUrl = environment.BASE_URL;
const integrationOnlyTestTagPattern =
  /@needs-(auth0-management|cloudflare|google-maps)\b/;

const createModeProject = (
  name: string,
  options: {
    dependencies: readonly string[];
    integrationOnly: boolean;
    testIgnore?: RegExp;
    testMatch?: RegExp;
    timeout?: number;
  },
) => ({
  dependencies: [...options.dependencies],
  grep: options.integrationOnly ? integrationOnlyTestTagPattern : undefined,
  grepInvert: options.integrationOnly
    ? undefined
    : integrationOnlyTestTagPattern,
  name,
  ...(options.testIgnore ? { testIgnore: options.testIgnore } : {}),
  ...(options.testMatch ? { testMatch: options.testMatch } : {}),
  ...(options.timeout ? { timeout: options.timeout } : {}),
  use: { ...devices['Desktop Chrome'], channel: 'chromium' },
});

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const webServer = (() => {
  if (environment.NO_WEBSERVER) {
    return;
  }

  const url = environment.BASE_URL;
  if (!url) {
    throw new Error('Missing base URL for Playwright webServer. Set BASE_URL.');
  }

  return {
    command: 'bun run docker:start:test',
    reuseExistingServer: true,
    timeout: 240_000,
    url,
  } as const;
})();

// Configure reporters: avoid blocking HTML server opening; prefer terminal output
const reporters = environment.CI
  ? [['github'], ['dot']]
  : [
      ['html', { open: 'never' }],
      ['dot'],
      ['./tests/support/reporters/documentation-reporter.ts'],
    ];

export default defineConfig({
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!environment.CI,
  ...(environment.CI ? { maxFailures: 1 } : {}),
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Configure projects for major browsers */
  projects: [
    {
      name: 'database-setup',
      retries: environment.CI ? 1 : 0,
      testDir: './tests/setup',
      testMatch: /database\.setup\.ts$/,
      timeout: 120_000,
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
    {
      dependencies: ['database-setup'],
      name: 'setup',
      retries: environment.CI ? 1 : 0,
      testDir: './tests/setup',
      testMatch: /authentication\.setup\.ts$/,
      timeout: 20_000,
      use: { ...devices['Desktop Chrome'], channel: 'chromium' },
    },
    createModeProject('docs-baseline', {
      dependencies: ['setup'],
      integrationOnly: false,
      testMatch: /docs\/.*\.doc\.ts$/,
      timeout: 60_000,
    }),
    createModeProject('local-chrome-baseline', {
      dependencies: ['setup'],
      integrationOnly: false,
      testIgnore: /docs\/.*\.doc\.ts$/,
    }),
    createModeProject('docs-integration', {
      dependencies: ['setup'],
      integrationOnly: true,
      testMatch: /docs\/.*\.doc\.ts$/,
      timeout: 60_000,
    }),
    createModeProject('local-chrome-integration', {
      dependencies: ['setup'],
      integrationOnly: true,
      testIgnore: /docs\/.*\.doc\.ts$/,
    }),
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
  /* Keep a single retry in CI for flakiness while still failing fast. */
  retries: environment.CI ? 1 : 0,
  testDir: './tests',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    ...(resolvedBaseUrl ? { baseURL: resolvedBaseUrl } : {}),
    /* Base URL to use in actions like `await page.goto('/')`. */
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
