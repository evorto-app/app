import { describe, expect, it } from '@effect/vitest';

import {
  evaluateRuntimePreflight,
  requiredByTarget,
} from './runtime-preflight';

const requiredDockerEnvironment = Object.fromEntries(
  requiredByTarget.docker.map(({ name }) => [
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
  it('reports all docker startup blockers before mutating containers', () => {
    const result = evaluateRuntimePreflight('docker', {
      cwd: '/repo',
      env: {
        CLIENT_ID: 'client-id',
        ISSUER_BASE_URL: 'issuer',
        NEON_PROJECT_ID: 'project-id',
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
            'NEON_API_KEY: Neon Local branch creation',
            'CLIENT_SECRET: Auth0 application secret',
            'FONT_AWESOME_TOKEN: Font Awesome package registry access for premium and brand icons',
            'STRIPE_API_KEY: Stripe API access for paid registration flows',
            'STRIPE_TEST_ACCOUNT_ID: Stripe connected account id for seeded paid flows',
          ]),
          label: 'Required docker runtime variables',
          severity: 'failure',
        }),
        expect.objectContaining({
          details: ['/repo/.env.dev'],
          label: 'Generated worktree runtime env file',
          severity: 'failure',
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
