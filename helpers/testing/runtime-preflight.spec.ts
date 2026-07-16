import { describe, expect, it } from '@effect/vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  evaluateRuntimePreflight,
  optionalByTarget,
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

const serviceBlock = (composeFile: string, service: string): string => {
  const match = new RegExp(
    String.raw`^  ${service}:\n([\s\S]*?)(?=^  [a-zA-Z0-9_-]+:|^secrets:|^volumes:)`,
    'm',
  ).exec(composeFile);

  if (!match) {
    throw new Error(`Missing Docker Compose service ${service}`);
  }

  return match[0];
};

describe('evaluateRuntimePreflight', () => {
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

  it('keeps Font Awesome package installs on the private Bun registry scope', () => {
    const bunfig = fs.readFileSync(
      path.join(process.cwd(), 'bunfig.toml'),
      'utf8',
    );
    const dockerfile = fs.readFileSync(
      path.join(process.cwd(), 'Dockerfile'),
      'utf8',
    );

    expect(bunfig).toContain('"@fortawesome"');
    expect(bunfig).toContain('url = "https://npm.fontawesome.com/"');
    expect(bunfig).toContain('token = "$FONT_AWESOME_TOKEN"');
    expect(dockerfile).toContain(
      'FONT_AWESOME_TOKEN="$(cat /run/secrets/FONT_AWESOME_TOKEN)" bun install',
    );
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
    expect(packageJson.scripts['docker:ps']).toBe(
      'bun run env:runtime && dotenv -c dev -- docker compose ps',
    );
    expect(packageJson.scripts['docker:stop']).toBe(
      'bun run env:runtime && dotenv -c dev -- docker compose down --timeout 60 --remove-orphans',
    );

    for (const scriptName of [
      'docker:start',
      'docker:start:watch',
      'docker:start:foreground',
    ]) {
      expect(packageJson.scripts[scriptName]).toMatch(
        /^bun run docker:check && dotenv -c dev -- docker compose down --timeout 60 --remove-orphans && /,
      );
    }

    expect(packageJson.scripts['docker:resume']).toBe(
      'bun run docker:check && dotenv -c dev -- bash helpers/testing/docker-resume.sh',
    );
    expect(packageJson.scripts['docker:webserver']).toBe(
      'bun run docker:check && dotenv -c dev -- bash helpers/testing/docker-webserver.sh',
    );
    expect(packageJson.scripts['test:e2e:check']).toBe(
      'bun run env:runtime && dotenv -c dev -- bun helpers/testing/runtime-preflight.ts playwright',
    );
    for (const scriptName of [
      'test:e2e',
      'test:e2e:docs',
      'test:e2e:integration',
      'test:e2e:ui',
    ]) {
      expect(packageJson.scripts[scriptName]).toMatch(
        /^bun run test:e2e:check && /,
      );
    }

    const disposableWebserverSource = fs.readFileSync(
      path.join(process.cwd(), 'helpers/testing/docker-webserver.sh'),
      'utf8',
    );
    expect(disposableWebserverSource).toMatch(
      /docker compose down --timeout 60 --remove-orphans --volumes/,
    );
    expect(disposableWebserverSource).toContain(
      'export E2E_RUNTIME_MODE=playwright',
    );

    const ciDockerStartSource = fs.readFileSync(
      path.join(process.cwd(), 'helpers/testing/ci-start-docker-stack.sh'),
      'utf8',
    );
    expect(ciDockerStartSource).toContain('export E2E_RUNTIME_MODE=playwright');

    const persistentLifecycleSources = [
      ciDockerStartSource,
      fs.readFileSync(
        path.join(process.cwd(), '.github/workflows/e2e-baseline.yml'),
        'utf8',
      ),
      fs.readFileSync(
        path.join(
          process.cwd(),
          '.github/workflows/esncard-release-certification.yml',
        ),
        'utf8',
      ),
      ...Object.values(packageJson.scripts),
    ].join('\n');
    for (const downCommand of persistentLifecycleSources.matchAll(
      /docker compose down[^\n"']*/g,
    )) {
      expect(downCommand[0]).toContain('--timeout 60');
      expect(downCommand[0]).toContain('--remove-orphans');
      expect(downCommand[0]).not.toContain('--volumes');
    }
    expect(
      `${persistentLifecycleSources}\n${disposableWebserverSource}`,
    ).not.toMatch(/docker[^\n]*\bprune\b/);

    const playwrightConfig = fs.readFileSync(
      path.join(process.cwd(), 'playwright.config.ts'),
      'utf8',
    );
    expect(playwrightConfig).toContain(
      "? 'bun run docker:webserver'\n    : 'bash helpers/testing/host-e2e-webserver.sh'",
    );
    expect(playwrightConfig).toContain(
      'reuseExistingServer: environment.NEON_LOCAL_PROXY',
    );
    expect(playwrightConfig).toMatch(
      /gracefulShutdown:\s*\{\s*signal:\s*'SIGTERM',\s*timeout:\s*300_000,?\s*\}/,
    );
    expect(playwrightConfig).not.toContain(
      "command: 'bun run docker:start:foreground'",
    );

    const hostE2eWebServer = fs.readFileSync(
      path.join(process.cwd(), 'helpers/testing/host-e2e-webserver.sh'),
      'utf8',
    );
    expect(hostE2eWebServer).toContain('set -euo pipefail');
    expect(hostE2eWebServer).toContain(
      'docker compose up --detach --no-deps minio',
    );
    expect(hostE2eWebServer).toContain(
      'docker compose run --rm --no-deps minio-init',
    );
    expect(hostE2eWebServer).toContain(
      'export S3_ENDPOINT="${local_s3_endpoint}"',
    );
    expect(hostE2eWebServer).toContain(
      'export S3_PUBLIC_ENDPOINT="${local_s3_endpoint}"',
    );
    expect(hostE2eWebServer).toMatch(
      /if wait "\$\{app_pid\}"; then\s+app_status=0\s+else\s+app_status="\$\?"\s+fi/,
    );
    expect(hostE2eWebServer).not.toContain('docker compose down');

    const testsGuidance = fs.readFileSync(
      path.join(process.cwd(), 'tests/AGENTS.md'),
      'utf8',
    );
    expect(testsGuidance).toContain('`bun run docker:webserver`');
  });

  it('keeps Angular SSR host validation aligned with local and seeded tenant hosts', () => {
    const angularJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'angular.json'), 'utf8'),
    ) as {
      projects: {
        evorto: {
          architect: {
            build: {
              options: {
                security?: {
                  allowedHosts?: string[];
                };
              };
            };
          };
        };
      };
    };

    expect(
      angularJson.projects.evorto.architect.build.options.security
        ?.allowedHosts,
    ).toEqual(
      expect.arrayContaining([
        'localhost',
        '127.0.0.1',
        'evorto.fly.dev',
        '*.evorto.app',
      ]),
    );
  });

  it('keeps local app routes reachable to lightweight GET and HEAD probes', () => {
    const serverSource = fs.readFileSync(
      path.join(process.cwd(), 'src/server.ts'),
      'utf8',
    );

    expect(serverSource).toContain("method === 'GET' || method === 'HEAD'");
    expect(serverSource).toContain('if (isSsrMethod(request.method))');
    expect(serverSource).not.toContain("if (request.method === 'GET') {");
  });

  it('keeps Playwright package scripts on the generated runtime environment path', () => {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };

    for (const scriptName of [
      'test:e2e:live-esncard',
      'test:e2e:live-esncard:release',
      'test:e2e:docs:publish',
    ]) {
      expect(packageJson.scripts[scriptName]).toContain('bun run env:runtime');
      expect(packageJson.scripts[scriptName]).toContain('dotenv -c dev --');
    }

    for (const scriptName of [
      'test:e2e',
      'test:e2e:ui',
      'test:e2e:integration',
      'test:e2e:docs',
    ]) {
      expect(packageJson.scripts[scriptName]).toContain(
        'bun run test:e2e:check',
      );
      expect(packageJson.scripts[scriptName]).toContain('dotenv -c dev --');
    }

    expect(packageJson.scripts['test:e2e:integration']).toContain(
      '--project=local-chrome-integration --project=docs-integration',
    );
    expect(packageJson.scripts['test:e2e:live-esncard']).toContain(
      'tests/specs/profile/user-profile-live-esncard.spec.ts',
    );
    expect(packageJson.scripts['test:e2e:live-esncard']).toContain(
      '--project=local-chrome-live-esncard',
    );
    expect(packageJson.scripts['test:e2e:live-esncard']).toContain(
      '--project=docs-live-esncard',
    );
    expect(packageJson.scripts['test:e2e:live-esncard']).toContain(
      "--grep '@needs-live-esncard'",
    );
    expect(packageJson.scripts['test:e2e:live-esncard:release']).toContain(
      'runtime-preflight.ts esncard-release',
    );
    expect(packageJson.scripts['test:e2e:live-esncard:release']).toContain(
      'bun run test:unit:esncard-provider-error',
    );
    expect(packageJson.scripts['test:e2e:live-esncard:release']).toContain(
      '--project=local-chrome-live-esncard',
    );
    expect(packageJson.scripts['test:e2e:live-esncard:release']).toContain(
      '--project=docs-live-esncard',
    );
    expect(packageJson.scripts['test:e2e:live-esncard:release']).toContain(
      '--trace=off',
    );
  });

  it('keeps required Docker variables wired into Compose services', () => {
    const composeFile = fs.readFileSync(
      path.join(process.cwd(), 'docker-compose.yml'),
      'utf8',
    );
    const dbService = serviceBlock(composeFile, 'db');
    const dbExpirationService = serviceBlock(composeFile, 'db-expiration');
    const dbSetupService = serviceBlock(composeFile, 'db-setup');
    const evortoService = serviceBlock(composeFile, 'evorto');
    const stripeService = serviceBlock(composeFile, 'stripe');
    const neonMetadataMount =
      '- "${NEON_LOCAL_METADATA_DIR:-neon-local-metadata}:/tmp/.neon_local"';

    expect(dbService).toContain('NEON_API_KEY:');
    expect(dbService).toContain('NEON_PROJECT_ID:');
    expect(dbService).toContain('restart: "no"');
    expect(dbService).toContain('stop_grace_period: 60s');
    expect(dbService).not.toContain('restart: on-failure');
    expect(dbService).toContain(neonMetadataMount);
    expect(dbService).toContain(
      'chown -R postgres:postgres /tmp/.neon_local && exec /usr/local/bin/startup.sh',
    );
    expect(dbExpirationService).toContain(neonMetadataMount);
    expect(dbExpirationService).toContain(
      'bun helpers/testing/set-neon-local-branch-expiration.ts',
    );
    expect(dbExpirationService).not.toContain('|| true');
    expect(composeFile).toContain('\n  neon-local-metadata:\n');
    expect(composeFile).not.toContain(
      '${NEON_LOCAL_METADATA_DIR:-./.neon_local}',
    );

    expect(dbSetupService).toContain('secrets:');
    expect(dbSetupService).toContain('- FONT_AWESOME_TOKEN');
    expect(dbSetupService).toContain('E2E_NOW_ISO:');
    expect(dbSetupService).toContain('E2E_SEED_KEY:');
    expect(dbSetupService).toContain('STRIPE_TEST_ACCOUNT_ID:');
    expect(dbSetupService).toContain('bun helpers/reset-database-schema.ts');
    expect(dbSetupService).toContain(
      'bun ./node_modules/drizzle-kit/bin.cjs push --force',
    );
    expect(dbSetupService).toContain('bun helpers/database.ts');

    for (const variable of [
      'CLIENT_ID',
      'CLIENT_SECRET',
      'E2E_NOW_ISO',
      'E2E_RUNTIME_MODE',
      'E2E_SEED_KEY',
      'ISSUER_BASE_URL',
      'NODE_ENV',
      'SECRET',
      'SSR_RPC_ORIGIN',
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
    expect(evortoService).toContain(
      'stripe:\n        condition: service_healthy',
    );
    expect(evortoService).toContain('S3_ENDPOINT: http://minio:9000');
    expect(evortoService).toContain(
      'S3_PUBLIC_ENDPOINT: "http://localhost:${MINIO_HOST_PORT:-9000}"',
    );
    expect(evortoService).toContain(
      'S3_ACCESS_KEY_ID: "${MINIO_ROOT_USER:-minioadmin}"',
    );
    expect(evortoService).toContain(
      'S3_SECRET_ACCESS_KEY: "${MINIO_ROOT_PASSWORD:-minioadmin}"',
    );
    expect(evortoService).not.toContain(
      'S3_ACCESS_KEY_ID: "${S3_ACCESS_KEY_ID:-minioadmin}"',
    );
    expect(evortoService).not.toContain(
      'S3_SECRET_ACCESS_KEY: "${S3_SECRET_ACCESS_KEY:-minioadmin}"',
    );
    expect(evortoService).toContain('NODE_ENV: "development"');
    expect(evortoService).toContain('E2E_RUNTIME_MODE:');
    expect(evortoService).not.toContain('E2E_RUNTIME_MODE: "playwright"');
    expect(evortoService).toContain('SSR_RPC_ORIGIN: http://localhost:4200');
    expect(evortoService).not.toContain(
      'S3_ENDPOINT: "${S3_ENDPOINT:-http://minio:9000}"',
    );
    expect(evortoService).toContain("trap 'cleanup_server TERM 143' TERM");
    expect(evortoService).toContain(
      'kill -"$$signal" "$$server_pid" 2>/dev/null || true',
    );
    expect(evortoService).toContain('finish_tee()');
    expect(evortoService).toContain('sleep 2');
    expect(evortoService).toContain(
      'kill -TERM "$$tee_pid" 2>/dev/null || true',
    );

    expect(stripeService).toContain('STRIPE_API_KEY:');
    expect(stripeService).toContain(
      './helpers/testing/stripe-listen-docker.sh',
    );
    expect(stripeService).toContain(
      'test: ["CMD-SHELL", "test -s /run/stripe-webhook/signing-secret"]',
    );
    expect(stripeService).toContain('start_period: 5s');

    const stripeListener = fs.readFileSync(
      path.join(process.cwd(), 'helpers/testing/stripe-listen-docker.sh'),
      'utf8',
    );
    expect(stripeListener).toContain("trap 'cleanup TERM 143' TERM");
    expect(stripeListener).toContain(
      'kill -"$signal" "$stripe_pid" 2>/dev/null || true',
    );
    expect(stripeListener).toContain('whsec_[REDACTED]');
    expect(stripeListener).not.toContain('  echo "$line"');

    const runtimeEnvironment = fs.readFileSync(
      path.join(process.cwd(), 'helpers/testing/runtime-environment.ts'),
      'utf8',
    );
    expect(runtimeEnvironment).toContain('DEFAULT_E2E_NOW_ISO');
    expect(runtimeEnvironment).toContain('DEFAULT_E2E_SEED_KEY');
    expect(runtimeEnvironment).toContain('E2E_NOW_ISO: e2eNowIso');
    expect(runtimeEnvironment).toContain('E2E_SEED_KEY: e2eSeedKey');
    expect(runtimeEnvironment).toContain("NODE_ENV: 'development'");
    expect(runtimeEnvironment).toContain('SSR_RPC_ORIGIN: baseUrl');

    const baseFixture = fs.readFileSync(
      path.join(process.cwd(), 'tests/support/fixtures/base-test.ts'),
      'utf8',
    );
    expect(baseFixture).toContain('const startedAt = performance.now()');
    expect(baseFixture).toContain('performance.now() - startedAt');
    expect(baseFixture).toContain('return currentTime()');
    expect(baseFixture).not.toContain(
      'static override now() {\n          return value;',
    );

    expect(composeFile).toContain('FONT_AWESOME_TOKEN:');
    expect(composeFile).toContain('environment: FONT_AWESOME_TOKEN');
  });

  it('keeps receipt approval fixtures pinned to worktree-local MinIO', () => {
    const source = fs.readFileSync(
      path.join(
        process.cwd(),
        'helpers/testing/upload-local-receipt-object.ts',
      ),
      'utf8',
    );

    expect(source).toContain('MINIO_HOST_PORT');
    expect(source).toContain('http://127.0.0.1:${minioHostPort}');
    expect(source).toContain('MINIO_ROOT_USER');
    expect(source).toContain('MINIO_ROOT_PASSWORD');
    expect(source).not.toContain("process.env['S3_ENDPOINT']");
    expect(source).not.toContain('cloudflarestorage.com');
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

  it('keeps the no-secret env example aligned with optional Docker variables', () => {
    const envExample = fs.readFileSync(
      path.join(process.cwd(), '.env.example'),
      'utf8',
    );

    for (const { name } of optionalByTarget.docker) {
      expect(envExample).toContain(`${name}=`);
    }
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
