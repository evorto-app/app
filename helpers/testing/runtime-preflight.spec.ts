import { describe, expect, it } from '@effect/vitest';

import {
  evaluateRuntimePreflight,
  requiredByTarget,
} from './runtime-preflight';

// Keeps Docker preflight failures readable by pinning the checks operators see
// before the stack starts rebuilding containers or touching local data.
const requiredDockerEnvironment = Object.fromEntries(
  requiredByTarget.docker.map(({ name }) => [
    name,
    `${name.toLowerCase()}-value`,
  ]),
);
const requiredPlaywrightEnvironment = Object.fromEntries(
  requiredByTarget.playwright.map(({ name }) => [
    name,
    `${name.toLowerCase()}-value`,
  ]),
);

const successfulCommand = (command: string, args: readonly string[]) => {
  const joined = [command, ...args].join(' ');

  if (joined === 'bun --version') {
    return {
      status: 0,
      stderr: '',
      stdout: '1.3.11\n',
    };
  }

  if (joined === 'docker compose version') {
    return {
      status: 0,
      stderr: '',
      stdout: 'Docker Compose version v5.1.1\n',
    };
  }

  if (joined === 'docker compose config --quiet') {
    return {
      status: 0,
      stderr: '',
      stdout: '',
    };
  }

  if (joined === 'bunx playwright --version') {
    return {
      status: 0,
      stderr: '',
      stdout: 'Version 1.59.1\n',
    };
  }

  if (joined === 'bunx playwright install --dry-run chromium') {
    return {
      status: 0,
      stderr: '',
      stdout: `
Chrome for Testing
  Install location:    /playwright/chromium
Chrome Headless Shell
  Install location:    /playwright/headless
FFmpeg
  Install location:    /playwright/ffmpeg
`,
    };
  }

  throw new Error(`Unexpected command ${joined}`);
};

describe('evaluateRuntimePreflight', () => {
  it('accepts the resolved invocation environment without a shared generated file', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: {
        ...requiredDockerEnvironment,
        EVORTO_RUNTIME_ENV_READY: 'true',
      },
      fileExists: () => false,
      runCommand: successfulCommand,
    });
    expect(result.checks).toContainEqual({
      details: ['Invocation environment resolved by env:run'],
      label: 'Generated worktree runtime environment',
      severity: 'ok',
    });
  });

  it('requires every authenticated account before Playwright but not Docker startup', () => {
    expect(
      requiredByTarget.playwright
        .map(({ name }) => name)
        .filter((name) => name.endsWith('_USER_PASSWORD')),
    ).toEqual([
      'E2E_DEFAULT_USER_PASSWORD',
      'E2E_ADMIN_USER_PASSWORD',
      'E2E_GLOBAL_ADMIN_USER_PASSWORD',
      'E2E_REGULAR_USER_PASSWORD',
      'E2E_ORGANIZER_USER_PASSWORD',
      'E2E_EMPTY_USER_PASSWORD',
    ]);
    expect(
      requiredByTarget.docker
        .map(({ name }) => name)
        .filter((name) => name.endsWith('_USER_PASSWORD')),
    ).toEqual([]);
    expect(
      requiredByTarget.playwright
        .map(({ name }) => name)
        .filter((name) => name.startsWith('AUTH0_MANAGEMENT_')),
    ).toEqual(['AUTH0_MANAGEMENT_CLIENT_ID', 'AUTH0_MANAGEMENT_CLIENT_SECRET']);

    const result = evaluateRuntimePreflight('playwright', {
      cwd: '/repo',
      env: requiredDockerEnvironment,
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });
    expect(result.failed).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: expect.arrayContaining([
            'E2E_DEFAULT_USER_PASSWORD: Auth0 password for an authenticated Playwright test account',
            'E2E_EMPTY_USER_PASSWORD: Auth0 password for an authenticated Playwright test account',
          ]),
          label: 'Required playwright runtime variables',
          severity: 'failure',
        }),
      ]),
    );
  });

  it('reports password variable names without exposing their values', () => {
    const passwordSentinel = 'never-print-this-test-value';
    const environment = Object.fromEntries(
      requiredByTarget.playwright.map(({ name }) => [name, passwordSentinel]),
    );
    const result = evaluateRuntimePreflight('playwright', {
      cwd: '/repo',
      env: environment,
      fileExists: () => true,
      runCommand: successfulCommand,
    });

    expect(JSON.stringify(result)).not.toContain(passwordSentinel);
  });

  it('reports all docker startup blockers before mutating containers', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: {
        CLIENT_ID: 'client-id',
        ISSUER_BASE_URL: 'issuer',
        SECRET: 'secret',
      },
      fileExists: (filePath) => filePath !== '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: expect.arrayContaining([
            'CLIENT_SECRET: Auth0 application secret',
            'FONT_AWESOME_TOKEN: Font Awesome package registry access for the premium icons',
            'STRIPE_API_KEY: Stripe API access for paid registration flows',
            'STRIPE_TEST_ACCOUNT_ID: Stripe connected account id for seeded paid flows',
          ]),
          label: 'Required docker runtime variables',
          severity: 'failure',
        }),
        expect.objectContaining({
          details: expect.arrayContaining([
            'CLIENT_ID: Auth0 application id',
            'ISSUER_BASE_URL: Auth0 issuer URL',
            'SECRET: Application session secret',
          ]),
          label: 'Available docker runtime variables',
          severity: 'ok',
        }),
        expect.objectContaining({
          details: ['/repo/.env.dev'],
          label: 'Generated worktree runtime environment',
          severity: 'failure',
        }),
      ]),
    );
  });

  it('reports optional live-provider variables without making them startup blockers', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: requiredDockerEnvironment,
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: [
            'missing E2E_LIVE_ESN_CARD_IDENTIFIER: Optional local active-card esncard.org Playwright coverage',
            'missing E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER: Optional local expired-card esncard.org Playwright coverage',
          ],
          label: 'Optional docker live-provider variables',
          severity: 'ok',
        }),
      ]),
    );
  });

  it('keeps optional live-provider variables visible when they are available', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: {
        ...requiredDockerEnvironment,
        E2E_LIVE_ESN_CARD_IDENTIFIER: 'live-card-id',
        E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER: 'expired-card-id',
      },
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: [
            'E2E_LIVE_ESN_CARD_IDENTIFIER: Optional local active-card esncard.org Playwright coverage',
            'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER: Optional local expired-card esncard.org Playwright coverage',
          ],
          label: 'Optional docker live-provider variables',
          severity: 'ok',
        }),
      ]),
    );
  });

  it('fails release certification closed when either approved ESNcard identifier is absent', () => {
    const result = evaluateRuntimePreflight('esncard-release', {
      cwd: '/repo',
      env: requiredPlaywrightEnvironment,
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: expect.arrayContaining([
            'E2E_LIVE_ESN_CARD_IDENTIFIER: Approved active non-production ESNcard identifier for mandatory release certification',
            'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER: Approved permanently expired non-production ESNcard identifier for mandatory release certification',
          ]),
          label: 'Required esncard-release runtime variables',
          severity: 'failure',
        }),
      ]),
    );
  });

  it('accepts both approved ESNcard identifiers without reporting their values', () => {
    const releaseIdentifier = 'approved-non-production-card';
    const expiredReleaseIdentifier = 'approved-expired-non-production-card';
    const result = evaluateRuntimePreflight('esncard-release', {
      cwd: '/repo',
      env: {
        ...requiredPlaywrightEnvironment,
        E2E_LIVE_ESN_CARD_IDENTIFIER: releaseIdentifier,
        E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER: expiredReleaseIdentifier,
      },
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(false);
    expect(JSON.stringify(result.checks)).not.toContain(releaseIdentifier);
    expect(JSON.stringify(result.checks)).not.toContain(
      expiredReleaseIdentifier,
    );
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: expect.arrayContaining([
            'E2E_LIVE_ESN_CARD_IDENTIFIER: Approved active non-production ESNcard identifier for mandatory release certification',
            'E2E_LIVE_ESN_CARD_EXPIRED_IDENTIFIER: Approved permanently expired non-production ESNcard identifier for mandatory release certification',
          ]),
          label: 'Available esncard-release runtime variables',
          severity: 'ok',
        }),
      ]),
    );
  });

  it('warns about missing Playwright browsers without blocking Docker start', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: requiredDockerEnvironment,
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(false);
    expect(result.warned).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: ['All required variables are present.'],
          label: 'Required docker runtime variables',
          severity: 'ok',
        }),
        expect.objectContaining({
          details: expect.arrayContaining([
            'Missing /playwright/chromium',
            'Missing /playwright/headless',
            'Missing /playwright/ffmpeg',
            'Run bun run test:e2e:install before local Playwright runs.',
          ]),
          label: 'Playwright Chromium browser installation',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('points local runs at system Chrome when bundled Chromium is missing and Chrome is available', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: requiredDockerEnvironment,
      fileExists: (filePath) =>
        filePath === '/repo/.env.dev' ||
        filePath === '/Applications/Google Chrome.app',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(false);
    expect(result.warned).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: expect.arrayContaining([
            'Or set E2E_BROWSER_CHANNEL=chrome to use /Applications/Google Chrome.app for local exploratory runs.',
          ]),
          label: 'Playwright Chromium browser installation',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('allows opt-in system Chrome to avoid the bundled Chromium cache warning', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: {
        ...requiredDockerEnvironment,
        E2E_BROWSER_CHANNEL: 'chrome',
      },
      fileExists: (filePath) =>
        filePath === '/repo/.env.dev' ||
        filePath === '/Applications/Google Chrome.app',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(false);
    expect(result.warned).toBe(false);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: [
            'Using E2E_BROWSER_CHANNEL=chrome with /Applications/Google Chrome.app',
          ],
          label: 'Playwright system Chrome browser channel',
          severity: 'ok',
        }),
      ]),
    );
  });

  it('warns when opt-in system Chrome is requested but missing', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: {
        ...requiredDockerEnvironment,
        E2E_BROWSER_CHANNEL: 'chrome',
      },
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.failed).toBe(false);
    expect(result.warned).toBe(true);
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: [
            'E2E_BROWSER_CHANNEL=chrome is set, but no system Chrome installation was found.',
            'Unset E2E_BROWSER_CHANNEL and run bun run test:e2e:install, or install Google Chrome for local exploratory runs.',
          ],
          label: 'Playwright system Chrome browser channel',
          severity: 'warning',
        }),
      ]),
    );
  });

  it('allows Docker to use the generated Stripe listener webhook secret file', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: requiredDockerEnvironment,
      fileExists: (filePath) => filePath === '/repo/.env.dev',
      runCommand: successfulCommand,
    });

    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          details: [
            'Docker Stripe CLI writes its generated signing secret to STRIPE_WEBHOOK_SECRET_FILE for the app container.',
          ],
          label: 'Stripe webhook signing secret source',
          severity: 'ok',
        }),
      ]),
    );
  });
});
