import { afterEach, describe, expect, it } from '@effect/vitest';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const stackScript = path.join(process.cwd(), 'helpers/testing/docker-stack.sh');
const composeSource = fs.readFileSync(
  path.join(process.cwd(), 'docker-compose.yml'),
  'utf8',
);
const temporaryDirectories: string[] = [];
const bunPathResult = spawnSync('/bin/sh', ['-c', 'command -v bun'], {
  encoding: 'utf8',
});
const realBunPath = bunPathResult.stdout.trim();
if (bunPathResult.status !== 0 || !realBunPath) {
  throw new Error('The Bun executable is required for Docker lifecycle tests');
}

const createFakeRuntime = ({
  buildStatus = 0,
  downStatus = 0,
  psStatus = 0,
  upStatus = 0,
}: {
  buildStatus?: number;
  downStatus?: number;
  psStatus?: number;
  upStatus?: number;
} = {}) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-docker-stack-'),
  );
  temporaryDirectories.push(directory);
  const bunLogPath = path.join(directory, 'bun.log');
  const dockerLogPath = path.join(directory, 'docker.log');
  const fakeBunPath = path.join(directory, 'bun');
  const fakeDockerPath = path.join(directory, 'docker');

  fs.writeFileSync(
    fakeBunPath,
    String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$BUN_LOG"
exec "$REAL_BUN" "$@"
`,
  );
  fs.writeFileSync(
    fakeDockerPath,
    String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
case "$*" in
  'compose down --timeout 60 --remove-orphans') exit "$FAKE_DOWN_STATUS" ;;
  'compose build') exit "$FAKE_BUILD_STATUS" ;;
  'compose up --no-build --detach') exit "$FAKE_UP_STATUS" ;;
  'compose ps --all') printf '%b\n' "$FAKE_COMPOSE_STATE"; exit "$FAKE_PS_STATUS" ;;
  'compose logs --no-color --tail=80') printf '%s\n' 'db-setup: last actionable failure' ;;
esac
exit 0
`,
  );
  fs.chmodSync(fakeBunPath, 0o700);
  fs.chmodSync(fakeDockerPath, 0o700);

  return {
    bunLogPath,
    dockerLogPath,
    environment: {
      ...process.env,
      BUN_LOG: bunLogPath,
      COMPOSE_PROJECT_NAME: 'evorto-test-project',
      DOCKER_LOG: dockerLogPath,
      FAKE_BUILD_STATUS: String(buildStatus),
      FAKE_COMPOSE_STATE: 'db-setup exited (1)\nevorto created',
      FAKE_DOWN_STATUS: String(downStatus),
      FAKE_PS_STATUS: String(psStatus),
      FAKE_UP_STATUS: String(upStatus),
      PATH: `${directory}:${process.env['PATH'] ?? ''}`,
      REAL_BUN: realBunPath,
    },
  };
};

afterEach(() => {
  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe('Compose database setup', () => {
  const runSetup = (preflightStatus: number) => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-compose-setup-'),
    );
    temporaryDirectories.push(directory);
    const logPath = path.join(directory, 'bun.log');
    fs.writeFileSync(
      path.join(directory, 'bun'),
      String.raw`#!/bin/sh
flag="$STAGING_SEED_PREFLIGHT_ONLY"
if [ -z "$flag" ]; then flag=unset; fi
printf '%s|%s\n' "$flag" "$*" >> "$BUN_LOG"
if [ "$flag" = true ]; then
  exit "$FAKE_PREFLIGHT_STATUS"
fi
exit 0
`,
      { mode: 0o700 },
    );
    const result = spawnSync(
      realBunPath,
      [
        '--no-env-file',
        '-e',
        `
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const command = Bun.YAML.parse(${JSON.stringify(composeSource)}).services['db-setup'].command;
assert.equal(command.length, 3);
assert.deepEqual(command.slice(0, 2), ['/bin/sh', '-lc']);
// A login shell may reset PATH; prepend the fake executable inside that shell.
const result = spawnSync(command[0], [command[1], 'PATH="$FAKE_BIN_DIR:$PATH"; export PATH; ' + command[2]], {
  env: process.env,
  stdio: 'inherit',
});
if (result.error) throw result.error;
assert.equal(result.signal, null);
process.exit(result.status ?? 1);
`,
      ],
      {
        encoding: 'utf8',
        env: {
          PATH: process.env['PATH'],
          FAKE_BIN_DIR: directory,
          BUN_LOG: logPath,
          FAKE_PREFLIGHT_STATUS: String(preflightStatus),
        },
        timeout: 5000,
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    return {
      result,
      invocations: fs.readFileSync(logPath, 'utf8').trim().split('\n'),
    };
  };

  it('stops before reset, Drizzle, and seeding when preflight fails', () => {
    const { result, invocations } = runSetup(37);
    expect(result.status, result.stderr).toBe(37);
    expect(invocations).toEqual(['true|helpers/database.ts']);
  });

  it('runs preflight, reset, schema push, then seed with the flag scoped to preflight', () => {
    const { result, invocations } = runSetup(0);
    expect(result.status, result.stderr).toBe(0);
    expect(invocations).toEqual([
      'true|helpers/database.ts',
      'unset|helpers/reset-database-schema.ts',
      'unset|./node_modules/drizzle-kit/bin.cjs push --force',
      'unset|helpers/database.ts',
    ]);
  });
});

describe('ordinary Docker stack lifecycle', () => {
  it.each(['e2e-baseline.yml', 'esncard-release-certification.yml'])(
    'keeps the direct Compose container URL aligned with credentials in %s',
    (workflowName) => {
      const workflowPath = path.join(
        process.cwd(),
        '.github/workflows',
        workflowName,
      );
      const result = spawnSync(
        realBunPath,
        [
          '--no-env-file',
          '-e',
          `import assert from 'node:assert/strict';
import { Client } from 'pg';
const workflow = Bun.YAML.parse(await Bun.file(${JSON.stringify(workflowPath)}).text());
const environments = Object.values(workflow.jobs).map((job) => job.env).filter((env) => env?.POSTGRES_DB);
assert.equal(environments.length, 1);
const environment = environments[0];
assert.equal(typeof environment.DOCKER_DATABASE_URL, 'string');
const client = new Client({ connectionString: environment.DOCKER_DATABASE_URL });
assert.equal(client.host, 'db');
assert.equal(client.port, 5432);
assert.equal(client.user, environment.POSTGRES_USER);
assert.equal(client.password, environment.POSTGRES_PASSWORD);
assert.equal(client.database, environment.POSTGRES_DB);`,
        ],
        { encoding: 'utf8', timeout: 5000 },
      );
      expect(result.status, result.stderr).toBe(0);
    },
  );

  it('uses one encoded container URL and literal database healthcheck arguments', () => {
    const result = spawnSync(
      realBunPath,
      [
        '--no-env-file',
        '-e',
        `const config = Bun.YAML.parse(${JSON.stringify(composeSource)});
process.stdout.write(JSON.stringify({
  urls: ['db-setup', 'evorto', 'worker'].map((service) => config.services[service].environment.DATABASE_URL),
  healthcheck: config.services.db.healthcheck.test,
}));`,
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    expect(result.status, result.stderr).toBe(0);
    const config: unknown = JSON.parse(result.stdout);
    expect(config).toEqual({
      healthcheck: [
        'CMD',
        'pg_isready',
        '-h',
        '127.0.0.1',
        '-p',
        '5432',
        '-U',
        '${POSTGRES_USER:-evorto}',
        '-d',
        '${POSTGRES_DB:-appdb}',
      ],
      urls: Array.from(
        { length: 3 },
        () =>
          '${DOCKER_DATABASE_URL:?Run Docker through a supported bun package command}',
      ),
    });
  });

  it('builds the Stripe listener without a host file share', () => {
    expect(composeSource).toContain(
      'dockerfile: helpers/testing/stripe-listener.Dockerfile',
    );
    expect(composeSource).toContain(
      'command: /usr/local/bin/stripe-listen-docker',
    );
    expect(composeSource).not.toContain(
      './helpers/testing/stripe-listen-docker.sh:',
    );
  });

  it('refuses to infer a Compose project', () => {
    const { dockerLogPath, environment } = createFakeRuntime();
    const result = spawnSync('bash', [stackScript, 'status'], {
      encoding: 'utf8',
      env: { ...environment, COMPOSE_PROJECT_NAME: '' },
    });

    expect(result.status, result.stderr).toBe(2);
    expect(result.stderr).toContain(
      'COMPOSE_PROJECT_NAME is required for local Docker commands.',
    );
    expect(fs.existsSync(dockerLogPath)).toBe(false);
  });

  it('bounds teardown, build, and detached startup without retrying', () => {
    const { bunLogPath, dockerLogPath, environment } = createFakeRuntime();
    const result = spawnSync('bash', [stackScript, 'start'], {
      encoding: 'utf8',
      env: environment,
    });

    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(dockerLogPath, 'utf8').trim().split('\n')).toEqual([
      'compose down --timeout 60 --remove-orphans',
      'compose build',
      'compose up --no-build --detach',
    ]);
    const timeoutInvocations = fs.readFileSync(bunLogPath, 'utf8');
    expect(timeoutInvocations).toContain(
      'run-with-wall-clock-timeout.ts 90 2 docker compose down --timeout 60 --remove-orphans',
    );
    expect(timeoutInvocations).toContain(
      'run-with-wall-clock-timeout.ts 720 2 docker compose build',
    );
    expect(timeoutInvocations).toContain(
      'run-with-wall-clock-timeout.ts 300 2 docker compose up --no-build --detach',
    );
  });

  it('surfaces state and logs when teardown reaches its wall-clock limit', () => {
    const { dockerLogPath, environment } = createFakeRuntime({
      downStatus: 124,
    });
    const result = spawnSync('bash', [stackScript, 'start'], {
      encoding: 'utf8',
      env: environment,
    });

    expect(result.status, result.stderr).toBe(124);
    expect(result.stderr).toContain(
      'Docker Compose teardown exceeded its 90-second wall-clock limit.',
    );
    expect(result.stderr).toContain('db-setup exited (1)');
    expect(result.stderr).toContain('db-setup: last actionable failure');
    expect(fs.readFileSync(dockerLogPath, 'utf8').trim().split('\n')).toEqual([
      'compose down --timeout 60 --remove-orphans',
      'compose ps --all',
      'compose logs --no-color --tail=80',
    ]);
  });

  it('does not retry or continue after a startup failure', () => {
    const { dockerLogPath, environment } = createFakeRuntime({ upStatus: 17 });
    const result = spawnSync('bash', [stackScript, 'start'], {
      encoding: 'utf8',
      env: environment,
    });

    expect(result.status, result.stderr).toBe(17);
    expect(result.stderr).toContain(
      'Docker Compose startup failed with status 17.',
    );
    expect(result.stderr).toContain('db-setup exited (1)');
    expect(fs.readFileSync(dockerLogPath, 'utf8').trim().split('\n')).toEqual([
      'compose down --timeout 60 --remove-orphans',
      'compose build',
      'compose up --no-build --detach',
      'compose ps --all',
      'compose logs --no-color --tail=80',
    ]);
  });

  it('does not retry a failed status inspection', () => {
    const { dockerLogPath, environment } = createFakeRuntime({ psStatus: 19 });
    const result = spawnSync('bash', [stackScript, 'status'], {
      encoding: 'utf8',
      env: environment,
    });

    expect(result.status, result.stderr).toBe(19);
    expect(result.stderr).toContain(
      'Docker Compose status inspection failed with status 19.',
    );
    expect(fs.readFileSync(dockerLogPath, 'utf8').trim()).toBe(
      'compose ps --all',
    );
  });
});
