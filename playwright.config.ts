import { defineConfig, devices, type Project } from '@playwright/test';
import { formatConfigError } from '@server/config/config-error';
import { APPLICATION_READINESS_PATH } from '@server/http/application-readiness';
import { ConfigError, ConfigProvider, Effect } from 'effect';
import { randomBytes } from 'node:crypto';

import { playwrightEnvironmentConfig } from './tests/support/config/environment';
import { resolvePlaywrightProjectPolicy } from './tests/support/config/playwright-project-policy';
import {
  resolvePlaywrightReporters,
  resolveProtectedValueSanitizerState,
} from './tests/support/config/protected-value-reporters';

// Suppress Playwright's optional prompt snapshot and mark the mandatory
// sanitizer below as active. Matcher-generated ARIA context is removed by the
// sanitizer reporter before any persistent reporter or artifact upload sees it.
process.env['PLAYWRIGHT_NO_COPY_PROMPT'] = '1';
process.env['E2E_TRANSIENT_AUTH0_USER_PASSWORD'] ??=
  `${randomBytes(24).toString('base64url')}aA1!`;

process.env['PLAYWRIGHT_PROTECTED_VALUE_SANITIZER'] =
  resolveProtectedValueSanitizerState({
    argv: process.argv,
    currentState: process.env['PLAYWRIGHT_PROTECTED_VALUE_SANITIZER'],
    environmentOverride: process.env['PW_TEST_REPORTER'],
  });

const environment = Effect.runSync(
  playwrightEnvironmentConfig.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnv(),
    ),
    Effect.mapError(
      (error: ConfigError.ConfigError) =>
        new Error(
          `Invalid Playwright e2e configuration:\n${formatConfigError(error)}`,
        ),
    ),
  ),
);
const resolvedBaseUrl = environment.BASE_URL;
const desktopChrome = {
  ...devices['Desktop Chrome'],
  channel: environment.E2E_BROWSER_CHANNEL,
};
const integrationOnlyTestTagPattern = /@needs-(auth0-management|google-maps)\b/;
const externalServiceTestTagPattern =
  /@needs-(auth0-management|google-maps|live-esncard)\b/;
const liveEsncardTestTagPattern = /@needs-live-esncard\b/;
const safeUiBaseline = process.env['PLAYWRIGHT_SAFE_UI_BASELINE'] === '1';
const projectPolicy = resolvePlaywrightProjectPolicy(safeUiBaseline);

const createModeProject = (
  name: string,
  options: {
    integrationOnly: boolean;
    testIgnore?: RegExp;
    testMatch?: RegExp;
    timeout?: number;
  },
): Project => ({
  dependencies: [...projectPolicy.modeDependencies],
  ...(options.integrationOnly
    ? { grep: integrationOnlyTestTagPattern }
    : { grepInvert: externalServiceTestTagPattern }),
  name,
  ...(options.testIgnore && { testIgnore: options.testIgnore }),
  ...(options.testMatch && { testMatch: options.testMatch }),
  ...(options.timeout && { timeout: options.timeout }),
  use: {
    ...desktopChrome,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },
});

/**
 * See https://playwright.dev/docs/test-configuration.
 */
const webServer = (() => {
  if (environment.NO_WEBSERVER) {
    return;
  }

  const command = environment.NEON_LOCAL_PROXY
    ? 'bun run docker:webserver'
    : 'bash helpers/testing/host-e2e-webserver.sh';

  const readinessUrl = new URL(
    APPLICATION_READINESS_PATH,
    environment.BASE_URL,
  ).toString();

  return {
    command,
    gracefulShutdown: {
      signal: 'SIGTERM',
      timeout: 300_000,
    },
    reuseExistingServer: environment.NEON_LOCAL_PROXY,
    // Match CI's 12-minute build plus 5-minute startup bounds so a cold local
    // run can finish building, initialize its services, and reach readiness.
    timeout: 1_020_000,
    url: readinessUrl,
  } as const;
})();

const listOnly = process.argv.includes('--list');

// Playwright API step titles can contain entered values. Keep the default
// reporter set non-persistent so Auth0 passwords and protected provider
// identifiers are not serialized to a local HTML report.
const reporters = resolvePlaywrightReporters({
  ci: environment.CI,
  listOnly,
});

export default defineConfig({
  /* Focused or flaky tests are never an acceptable local or CI result. */
  failOnFlakyTests: true,
  forbidOnly: true,
  ...(environment.CI && { maxFailures: 1 }),
  /* Run tests in files in parallel */
  fullyParallel: true,
  // Downstream reporters must never print raw worker stdout/stderr. The first
  // reporter emits the same chunks after exact protected-value redaction.
  quiet: true,
  // Avoid launching enough macOS browser app bundles at once to deadlock
  // LaunchServices before Playwright can connect to Chromium's debug pipe.
  workers: environment.CI ? 1 : 4,
  /* Configure projects for major browsers */
  projects: [
    {
      name: 'database-setup',
      testDir: './tests/setup',
      testMatch: /database\.setup\.ts$/,
      timeout: 120_000,
      use: desktopChrome,
    },
    ...(projectPolicy.includeAuthenticatedProjects
      ? [
          {
            dependencies: ['database-setup'],
            name: 'setup',
            testDir: './tests/setup',
            testMatch: /authentication\.setup\.ts$/,
            timeout: 20_000,
            use: {
              ...desktopChrome,
              screenshot: 'off',
              trace: 'off',
              video: 'off',
            },
          },
          {
            dependencies: ['setup'],
            grep: liveEsncardTestTagPattern,
            name: 'local-chrome-live-esncard',
            testMatch: /specs\/profile\/user-profile-live-esncard\.spec\.ts$/,
            timeout: 120_000,
            use: {
              ...desktopChrome,
              screenshot: 'off',
              trace: 'off',
              video: 'off',
            },
          },
          {
            dependencies: ['setup'],
            grep: liveEsncardTestTagPattern,
            name: 'docs-live-esncard',
            testMatch: /docs\/profile\/discounts\.doc\.ts$/,
            timeout: 120_000,
            use: {
              ...desktopChrome,
              screenshot: 'off',
              trace: 'off',
              video: 'off',
            },
          },
        ]
      : []),
    createModeProject('docs-baseline', {
      integrationOnly: false,
      testMatch: /docs\/.*\.doc\.ts$/,
      timeout: 60_000,
    }),
    createModeProject('local-chrome-baseline', {
      integrationOnly: false,
      testIgnore: /docs\/.*\.doc\.ts$/,
    }),
    ...(projectPolicy.includeAuthenticatedProjects
      ? [
          createModeProject('local-chrome-integration', {
            integrationOnly: true,
            testIgnore: /docs\/.*\.doc\.ts$/,
          }),
          createModeProject('docs-integration', {
            integrationOnly: true,
            testMatch: /docs\/.*\.doc\.ts$/,
            timeout: 60_000,
          }),
        ]
      : []),
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
  /* A passing run must not depend on retries. */
  retries: 0,
  testDir: './tests',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    ...(resolvedBaseUrl && { baseURL: resolvedBaseUrl }),
    /* Base URL to use in actions like `await page.goto('/')`. */
    colorScheme: 'light',

    /* Ignore SSL errors when connecting to Auth0 and other external services */
    ignoreHTTPSErrors: true,
    screenshot: 'off',
    trace: 'off',
    video: 'off',
  },

  ...(webServer && { webServer }),
});
