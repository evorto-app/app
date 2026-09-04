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

describe('ordinary Docker stack lifecycle', () => {
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
