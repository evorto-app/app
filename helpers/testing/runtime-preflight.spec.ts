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

const successfulCommand = (
  command: string,
  commandArguments: readonly string[],
) => {
  const joined = [command, ...commandArguments].join(' ');

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
  it('keeps Docker and local Font Awesome installs on the public registry', () => {
    const dockerfile = fs.readFileSync(
      path.join(process.cwd(), 'Dockerfile'),
      'utf8',
    );
    const bunfig = fs.readFileSync(
      path.join(process.cwd(), 'bunfig.toml'),
      'utf8',
    );

    expect(fs.existsSync(path.join(process.cwd(), '.npmrc'))).toBe(false);
    expect(dockerfile).not.toContain('FONT_AWESOME_TOKEN');
    expect(dockerfile).not.toContain('npm.fontawesome.com');
    expect(dockerfile).toContain(
      'NPM_CONFIG_USERCONFIG=/tmp/npmrc-public-fontawesome',
    );
    expect(dockerfile).toContain(
      "'@fortawesome:registry=https://registry.npmjs.org/'",
    );

    expect(bunfig).toContain('[install.scopes]');
    expect(bunfig).toContain('"@fortawesome" = "https://registry.npmjs.org/"');
  });

  it('keeps Font Awesome packages on public npm artifacts', () => {
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
    expect(
      packageJson.dependencies['@fortawesome/duotone-regular-svg-icons'],
    ).toBe('npm:@fortawesome/free-solid-svg-icons@^7.2.0');

    for (const packageName of [
      '@fortawesome/duotone-regular-svg-icons',
      '@fortawesome/free-brands-svg-icons',
    ]) {
      expect(lockfile).toContain(`"${packageName}"`);
    }
    expect(lockfile).toContain('@fortawesome/free-solid-svg-icons@7.2.0');
    expect(lockfile).not.toContain('npm.fontawesome.com');
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
    expect(packageJson.scripts['docker:webserver']).toBe(
      'bun run docker:check && dotenv -c dev -- docker compose up --build',
    );

    const playwrightConfig = fs.readFileSync(
      path.join(process.cwd(), 'playwright.config.ts'),
      'utf8',
    );
    expect(playwrightConfig).toContain("command: 'bun run docker:webserver'");
    expect(playwrightConfig).not.toContain(
      "command: 'bun run docker:start:foreground'",
    );

    const testsGuidance = fs.readFileSync(
      path.join(process.cwd(), 'tests/AGENTS.md'),
      'utf8',
    );
    expect(testsGuidance).toContain('`bun run docker:webserver`');
    expect(testsGuidance).not.toContain('`bun run docker:start:foreground`');
  });

  it('keeps generated runtime ports stable for non-mutating Docker checks', () => {
    const runtimeEnvironment = fs.readFileSync(
      path.join(process.cwd(), 'helpers/testing/runtime-environment.ts'),
      'utf8',
    );
    const testsReadme = fs.readFileSync(
      path.join(process.cwd(), 'tests/README.md'),
      'utf8',
    );
    const helpersReadme = fs.readFileSync(
      path.join(process.cwd(), 'helpers/README.md'),
      'utf8',
    );

    expect(runtimeEnvironment).toContain(
      'const existingRuntimeEnvironment = readExistingRuntimeEnvironment();',
    );
    expect(runtimeEnvironment).toContain(
      'const parsed = parsePort(existingRuntimeEnvironment[name]);',
    );
    expect(testsReadme).toContain(
      'later package scripts preserve its generated local',
    );
    expect(helpersReadme).toContain(
      'later package-script preflights preserve the',
    );
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
      'test:e2e',
      'test:e2e:ui',
      'test:e2e:integration',
      'test:e2e:create-account',
      'test:e2e:esncard-provider',
      'test:e2e:docs',
      'test:e2e:docs:publish',
    ]) {
      expect(packageJson.scripts[scriptName]).toContain('bun run env:runtime');
      expect(packageJson.scripts[scriptName]).toContain('dotenv -c dev --');
    }

    expect(packageJson.scripts['test:e2e:integration']).toContain(
      '--project=local-chrome-integration --project=docs-integration',
    );
    expect(packageJson.scripts['test:e2e:integration']).toContain(
      'DOCS_OUT_DIR=test-results/docs DOCS_IMG_OUT_DIR=test-results/docs/images',
    );
    expect(packageJson.scripts['test:e2e:create-account']).toContain(
      'tests/specs/profile/create-account.spec.ts',
    );
    expect(packageJson.scripts['test:e2e:create-account']).toContain(
      'tests/docs/users/create-account.doc.ts',
    );
    expect(packageJson.scripts['test:e2e:create-account']).toContain(
      '--project=local-chrome-integration --project=docs-integration',
    );
    expect(packageJson.scripts['test:e2e:create-account']).toContain(
      'DOCS_OUT_DIR=test-results/docs DOCS_IMG_OUT_DIR=test-results/docs/images',
    );
    expect(packageJson.scripts['test:e2e:create-account']).toContain(
      "--grep '@needs-auth0-management'",
    );
    expect(packageJson.scripts['test:e2e:docs']).toContain(
      'DOCS_OUT_DIR=test-results/docs DOCS_IMG_OUT_DIR=test-results/docs/images',
    );
    expect(packageJson.scripts['test:e2e:docs:publish']).toContain(
      'DOCS_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/src/app/docs',
    );
    expect(packageJson.scripts['test:e2e:docs:publish']).toContain(
      'DOCS_IMG_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/public/docs',
    );
    expect(packageJson.scripts['test:e2e:esncard-provider']).toContain(
      'tests/specs/profile/user-profile-esncard-provider.spec.ts',
    );
    expect(packageJson.scripts['test:e2e:esncard-provider']).toContain(
      '--project=local-chrome-baseline',
    );
    expect(packageJson.scripts['test:e2e:esncard-provider']).toContain(
      "--grep '@esncard-provider'",
    );
  });

  it('keeps Playwright list discovery away from file-writing reporters', () => {
    const playwrightConfig = fs.readFileSync(
      path.join(process.cwd(), 'playwright.config.ts'),
      'utf8',
    );

    expect(playwrightConfig).toContain(
      "const listOnly = process.argv.includes('--list');",
    );
    expect(playwrightConfig).toContain(': listOnly');
    expect(playwrightConfig).toContain("? [['dot']]");
    expect(playwrightConfig).toContain("['html', { open: 'never' }]");
    expect(playwrightConfig).toContain(
      "['./tests/support/reporters/documentation-reporter.ts']",
    );
  });

  it('keeps required Docker variables wired into Compose services', () => {
    const composeFile = fs.readFileSync(
      path.join(process.cwd(), 'docker-compose.yml'),
      'utf8',
    );
    const databaseService = serviceBlock(composeFile, 'db');
    const databaseSetupService = serviceBlock(composeFile, 'db-setup');
    const evortoService = serviceBlock(composeFile, 'evorto');
    const stripeService = serviceBlock(composeFile, 'stripe');

    expect(databaseService).toContain('NEON_API_KEY:');
    expect(databaseService).toContain('NEON_PROJECT_ID:');

    expect(databaseSetupService).not.toContain('secrets:');
    expect(databaseSetupService).not.toContain('FONT_AWESOME_TOKEN');
    expect(databaseSetupService).toContain('STRIPE_TEST_ACCOUNT_ID:');
    expect(databaseSetupService).toContain(
      'bun helpers/reset-database-schema.ts',
    );
    expect(databaseSetupService).toContain(
      'bun ./node_modules/drizzle-kit/bin.cjs push --force',
    );
    expect(databaseSetupService).toContain('bun helpers/database.ts');

    for (const variable of [
      'CLIENT_ID',
      'CLIENT_SECRET',
      'ISSUER_BASE_URL',
      'SECRET',
      'SSR_RPC_ORIGIN',
      'STRIPE_API_KEY',
      'STRIPE_TEST_ACCOUNT_ID',
      'STRIPE_WEBHOOK_SECRET_FILE',
    ]) {
      expect(evortoService).toContain(`${variable}:`);
    }
    expect(evortoService).not.toContain('secrets:');
    expect(evortoService).not.toContain('FONT_AWESOME_TOKEN');
    expect(evortoService).toContain(
      'STRIPE_WEBHOOK_SECRET_FILE: /run/stripe-webhook/signing-secret',
    );
    expect(evortoService).toContain('S3_ENDPOINT: http://minio:9000');
    expect(evortoService).toContain('SSR_RPC_ORIGIN: http://localhost:4200');
    expect(evortoService).not.toContain(
      'S3_ENDPOINT: "${S3_ENDPOINT:-http://minio:9000}"',
    );

    expect(stripeService).toContain('STRIPE_API_KEY:');
    expect(stripeService).toContain(
      './helpers/testing/stripe-listen-docker.sh',
    );

    expect(composeFile).not.toContain('FONT_AWESOME_TOKEN');
    expect(composeFile).not.toContain('environment: FONT_AWESOME_TOKEN');
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

  it('does not require external provider variables for Docker startup', () => {
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
          details: ['No optional variables are configured for this target.'],
          label: 'Optional docker variables',
          severity: 'ok',
        }),
      ]),
    );
  });

  it('keeps the no-secret env example aligned with required Docker variables', () => {
    const environmentExample = fs.readFileSync(
      path.join(process.cwd(), '.env.example'),
      'utf8',
    );

    for (const { name } of requiredByTarget.docker) {
      expect(environmentExample).toContain(`${name}=`);
    }
    expect(environmentExample).toContain(
      'Do not put real secret values in this file.',
    );
  });

  it('keeps removed provider variables out of the no-secret env example', () => {
    const environmentExample = fs.readFileSync(
      path.join(process.cwd(), '.env.example'),
      'utf8',
    );

    for (const { name } of optionalByTarget.docker) {
      expect(environmentExample).toContain(`${name}=`);
    }
    expect(environmentExample).not.toContain('E2E_LIVE_ESN_CARD_IDENTIFIER');
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
