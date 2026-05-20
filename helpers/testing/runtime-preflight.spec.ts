import { describe, expect, it } from '@effect/vitest';
import fs from 'node:fs';
import path from 'node:path';

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

const serviceBlock = (composeFile: string, service: string): string => {
  const match = new RegExp(
    `^  ${service}:\\n([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:|^secrets:|^volumes:)`,
    'm',
  ).exec(composeFile);

  if (!match) {
    throw new Error(`Missing Docker Compose service ${service}`);
  }

  return match[0];
};

describe('evaluateRuntimePreflight', () => {
  it('keeps Docker and local Font Awesome registry scopes aligned', () => {
    const dockerfile = fs.readFileSync(
      path.join(process.cwd(), 'Dockerfile'),
      'utf8',
    );
    const npmrc = fs.readFileSync(path.join(process.cwd(), '.npmrc'), 'utf8');

    for (const registryScope of [
      '@fortawesome:registry=https://npm.fontawesome.com/',
      '@awesome.me:registry=https://npm.fontawesome.com/',
    ]) {
      expect(dockerfile).toContain(registryScope);
      expect(npmrc).toContain(registryScope);
    }

    expect(dockerfile).toContain('//npm.fontawesome.com/:_authToken=%s');
    expect(npmrc).toContain('//npm.fontawesome.com/:_authToken=');
  });

  it('keeps premium and brand icon packages on the Font Awesome registry path', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { dependencies: Record<string, string> };
    const lockfile = fs.readFileSync(
      path.join(process.cwd(), 'bun.lock'),
      'utf8',
    );

    expect(packageJson.dependencies).toEqual(
      expect.objectContaining({
        '@fortawesome/duotone-regular-svg-icons': expect.any(String),
        '@fortawesome/free-brands-svg-icons': expect.any(String),
      }),
    );

    for (const packageName of [
      '@fortawesome/duotone-regular-svg-icons',
      '@fortawesome/free-brands-svg-icons',
    ]) {
      expect(lockfile).toContain(
        `https://npm.fontawesome.com/${packageName}/-/`,
      );
    }
  });

  it('keeps Docker startup scripts behind the non-mutating preflight', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    expect(packageJson.scripts['docker:check']).toBe(
      'bun run env:runtime && dotenv -c dev -- bun helpers/testing/runtime-preflight.ts docker',
    );

    for (const scriptName of [
      'docker:start',
      'docker:start:watch',
      'docker:start:foreground',
    ]) {
      expect(packageJson.scripts[scriptName]).toMatch(
        /^bun run docker:check && dotenv -c dev -- docker compose down && /,
      );
    }

    expect(packageJson.scripts['docker:resume']).toBe(
      'bun run docker:check && dotenv -c dev -- docker compose up --no-recreate -d',
    );
  });

  it('keeps required Docker variables wired into Compose services', () => {
    const composeFile = fs.readFileSync(
      path.join(process.cwd(), 'docker-compose.yml'),
      'utf8',
    );
    const dbService = serviceBlock(composeFile, 'db');
    const dbSetupService = serviceBlock(composeFile, 'db-setup');
    const evortoService = serviceBlock(composeFile, 'evorto');
    const stripeService = serviceBlock(composeFile, 'stripe');

    expect(dbService).toContain('NEON_API_KEY:');
    expect(dbService).toContain('NEON_PROJECT_ID:');

    expect(dbSetupService).toContain('secrets:');
    expect(dbSetupService).toContain('- FONT_AWESOME_TOKEN');
    expect(dbSetupService).toContain('STRIPE_TEST_ACCOUNT_ID:');

    for (const variable of [
      'CLIENT_ID',
      'CLIENT_SECRET',
      'ISSUER_BASE_URL',
      'SECRET',
      'STRIPE_API_KEY',
      'STRIPE_TEST_ACCOUNT_ID',
      'STRIPE_WEBHOOK_SECRET_FILE',
    ]) {
      expect(evortoService).toContain(`${variable}:`);
    }
    expect(evortoService).toContain('secrets:');
    expect(evortoService).toContain('- FONT_AWESOME_TOKEN');
    expect(evortoService).toContain(
      'STRIPE_WEBHOOK_SECRET_FILE: /run/stripe-webhook/signing-secret',
    );
    expect(evortoService).toContain('S3_ENDPOINT: http://minio:9000');
    expect(evortoService).not.toContain(
      'S3_ENDPOINT: "${S3_ENDPOINT:-http://minio:9000}"',
    );

    expect(stripeService).toContain('STRIPE_API_KEY:');
    expect(stripeService).toContain(
      './helpers/testing/stripe-listen-docker.sh',
    );

    expect(composeFile).toContain('FONT_AWESOME_TOKEN:');
    expect(composeFile).toContain('environment: FONT_AWESOME_TOKEN');
  });

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
          details: expect.arrayContaining([
            'CLIENT_ID: Auth0 application id',
            'ISSUER_BASE_URL: Auth0 issuer URL',
            'NEON_PROJECT_ID: Neon Local project selection',
            'SECRET: Application session secret',
          ]),
          label: 'Available docker runtime variables',
          severity: 'ok',
        }),
        expect.objectContaining({
          details: ['/repo/.env.dev'],
          label: 'Generated worktree runtime env file',
          severity: 'failure',
        }),
      ]),
    );
  });

  it('keeps the no-secret env example aligned with required Docker variables', () => {
    const envExample = fs.readFileSync(
      path.join(process.cwd(), '.env.example'),
      'utf8',
    );

    for (const { name } of requiredByTarget.docker) {
      expect(envExample).toContain(`${name}=`);
    }
    expect(envExample).toContain('Do not put real secret values in this file.');
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
