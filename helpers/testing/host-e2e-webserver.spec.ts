import { afterEach, describe, expect, it } from '@effect/vitest';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const hostScript = path.join(
  process.cwd(),
  'helpers/testing/host-e2e-webserver.sh',
);
const leaseScript = path.join(
  process.cwd(),
  'helpers/testing/with-docker-project-lease.sh',
);
const temporaryDirectories: string[] = [];
const leaseProjects = new Set<string>();
const userId = process.getuid?.();
if (userId === undefined)
  throw new Error('Host Docker ownership requires a Unix user identity');
const leaseDirectory = path.join(
  '/tmp',
  `evorto-docker-project-leases-${userId}`,
);

const createFixture = (
  minioState: 'absent' | 'running' | 'stopped' = 'stopped',
) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-host-lease-'),
  );
  temporaryDirectories.push(directory);
  const project = path.basename(directory).toLowerCase();
  leaseProjects.add(project);
  const files = {
    appReady: path.join(directory, 'app-ready'),
    appRelease: path.join(directory, 'app-release'),
    appStopping: path.join(directory, 'app-stopping'),
    created: path.join(directory, 'created'),
    dockerLog: path.join(directory, 'docker.log'),
    initReady: path.join(directory, 'init-ready'),
    initRelease: path.join(directory, 'init-release'),
    restoreReady: path.join(directory, 'restore-ready'),
    restoreRelease: path.join(directory, 'restore-release'),
  };
  fs.writeFileSync(
    path.join(directory, 'docker'),
    String.raw`#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$TEST_HOST_DOCKER_LOG"
case "$*" in
  'compose ps --all --quiet minio')
    if [[ "$TEST_HOST_MINIO_STATE" != absent || -f "$TEST_HOST_CREATED" ]]; then
      printf '%s\n' minio-container
    fi
    ;;
  'inspect --format {{.State.Running}} minio-container')
    if [[ "$TEST_HOST_MINIO_STATE" == running ]]; then printf 'true\n'; else printf 'false\n'; fi
    ;;
  'start minio-container') ;;
  'compose up --detach --no-deps minio') touch "$TEST_HOST_CREATED" ;;
  'compose run --rm --no-deps minio-init')
    touch "$TEST_HOST_INIT_READY"
    while [[ ! -f "$TEST_HOST_INIT_RELEASE" ]]; do sleep 0.02; done
    ;;
  'stop --time 10 minio-container' | 'rm --force minio-container')
    touch "$TEST_HOST_RESTORE_READY"
    while [[ ! -f "$TEST_HOST_RESTORE_RELEASE" ]]; do sleep 0.02; done
    ;;
  *) printf 'Unexpected fake Docker command: %s\n' "$*" >&2; exit 64 ;;
esac
`,
    { mode: 0o700 },
  );
  fs.writeFileSync(
    path.join(directory, 'curl'),
    '#!/usr/bin/env bash\nexit 0\n',
    { mode: 0o700 },
  );
  fs.writeFileSync(
    path.join(directory, 'bun'),
    `#!${process.execPath}
const fs = require('node:fs');
if (process.argv.slice(2).join(' ') !== 'run dev:ng serve --port 4400 --allowed-hosts') throw new Error('Unexpected app command');
fs.writeFileSync(process.env.TEST_HOST_APP_READY, 'ready');
process.once('SIGTERM', () => fs.writeFileSync(process.env.TEST_HOST_APP_STOPPING, 'stopping'));
const timer = setInterval(() => {
  if (fs.existsSync(process.env.TEST_HOST_APP_RELEASE)) clearInterval(timer);
}, 20);
`,
    { mode: 0o700 },
  );
  return {
    directory,
    environment: {
      ...process.env,
      APP_HOST_PORT: '4400',
      COMPOSE_PROJECT_NAME: project,
      EVORTO_DOCKER_PROJECT_LEASE_HELD: '',
      MINIO_HOST_PORT: '4401',
      PATH: `${directory}${path.delimiter}${process.env['PATH'] ?? ''}`,
      TEST_HOST_APP_READY: files.appReady,
      TEST_HOST_APP_RELEASE: files.appRelease,
      TEST_HOST_APP_STOPPING: files.appStopping,
      TEST_HOST_CREATED: files.created,
      TEST_HOST_DOCKER_LOG: files.dockerLog,
      TEST_HOST_INIT_READY: files.initReady,
      TEST_HOST_INIT_RELEASE: files.initRelease,
      TEST_HOST_MINIO_STATE: minioState,
      TEST_HOST_RESTORE_READY: files.restoreReady,
      TEST_HOST_RESTORE_RELEASE: files.restoreRelease,
      TMPDIR: directory,
    },
    files,
  };
};

// Full server runs start many native processes concurrently. Bound each readiness
// and teardown wait without treating intentional lifecycle gates as a hang.
const processWaitTimeoutMs = 10_000;
const commandTimeoutMs = 5000;

const observeChild = (child: ChildProcess, dockerLog: string) => {
  let stdout = '';
  let stderr = '';
  let launchError: Error | undefined;
  let settled = false;
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const completed = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((resolve) => {
    child.once('close', (code, signal) => {
      settled = true;
      resolve({ code, signal });
    });
    child.once('error', (error) => {
      launchError = error;
      settled = true;
      resolve({ code: null, signal: null });
    });
  });
  return {
    child,
    completed,
    diagnostics: () =>
      [
        `pid=${child.pid ?? 'unavailable'} code=${child.exitCode} signal=${child.signalCode}`,
        `launch error: ${launchError?.message ?? 'none'}`,
        `stdout: ${stdout}`,
        `stderr: ${stderr}`,
        `Docker commands: ${fs.existsSync(dockerLog) ? fs.readFileSync(dockerLog, 'utf8') : '(none)'}`,
      ].join('\n'),
    hasExited: () => settled,
  };
};

type ObservedChild = ReturnType<typeof observeChild>;

const waitForFile = async (file: string, command: ObservedChild) => {
  const deadline = Date.now() + processWaitTimeoutMs;
  while (!fs.existsSync(file)) {
    if (command.hasExited()) {
      throw new Error(`Child exited before ${file}\n${command.diagnostics()}`);
    }
    if (Date.now() >= deadline)
      throw new Error(
        `Timed out waiting for ${file}\n${command.diagnostics()}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const finishChild = async (command: ObservedChild) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      command.completed,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          command.child.kill('SIGKILL');
          reject(
            new Error(
              `Child did not exit after release\n${command.diagnostics()}`,
            ),
          );
        }, processWaitTimeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

const releaseFixture = (fixture: ReturnType<typeof createFixture>) => {
  for (const file of [
    fixture.files.initRelease,
    fixture.files.appRelease,
    fixture.files.restoreRelease,
  ]) {
    fs.writeFileSync(file, 'release');
  }
};

afterEach(() => {
  for (const directory of temporaryDirectories)
    fs.rmSync(directory, { recursive: true, force: true });
  temporaryDirectories.length = 0;
  for (const project of leaseProjects) {
    fs.rmSync(path.join(leaseDirectory, `${project}.owner`), { force: true });
    fs.rmSync(path.join(leaseDirectory, `${project}.lock`), { force: true });
  }
  leaseProjects.clear();
});

describe('Host Playwright project ownership', { timeout: 120_000 }, () => {
  it('rejects another project command before inspecting or changing MinIO', async () => {
    const fixture = createFixture();
    const ready = path.join(fixture.directory, 'owner-ready');
    const release = path.join(fixture.directory, 'owner-release');
    const owner = spawn(
      'bash',
      [
        leaseScript,
        'docker-stop',
        '--',
        'bash',
        '-c',
        'touch "$1"; while [[ ! -f "$2" ]]; do sleep 0.02; done',
        'owner',
        ready,
        release,
      ],
      { env: fixture.environment, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const observedOwner = observeChild(owner, fixture.files.dockerLog);
    try {
      await waitForFile(ready, observedOwner);
      const result = spawnSync('bash', [hostScript], {
        env: fixture.environment,
        encoding: 'utf8',
        timeout: commandTimeoutMs,
      });
      expect(result.status, result.stderr).toBe(75);
      expect(result.stderr).toContain('operation=docker-stop');
      expect(fs.existsSync(fixture.files.dockerLog)).toBe(false);
    } finally {
      fs.writeFileSync(release, 'release');
      await finishChild(observedOwner);
    }
  });

  it('reports an early host exit with its status and stderr', async () => {
    const fixture = createFixture();
    const host = spawn('bash', [hostScript], {
      env: { ...fixture.environment, APP_HOST_PORT: '' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const observedHost = observeChild(host, fixture.files.dockerLog);
    try {
      await expect(
        waitForFile(fixture.files.initReady, observedHost),
      ).rejects.toThrow(
        /Child exited before[\s\S]*code=2[\s\S]*APP_HOST_PORT is required/u,
      );
      expect(fs.existsSync(fixture.files.dockerLog)).toBe(false);
    } finally {
      releaseFixture(fixture);
      await finishChild(observedHost);
    }
  });

  it('rejects an inherited ownership marker whose descriptor was closed', () => {
    const fixture = createFixture();
    const result = spawnSync(
      'bash',
      [
        leaseScript,
        'docker-start',
        '--',
        'bash',
        '-c',
        'exec 9>&-; exec bash "$1"',
        'closed-descriptor',
        hostScript,
      ],
      { env: fixture.environment, encoding: 'utf8', timeout: commandTimeoutMs },
    );
    expect(result.status, result.stderr).toBe(75);
    expect(result.stderr).toContain('requires the inherited lease descriptor');
    expect(fs.existsSync(fixture.files.dockerLog)).toBe(false);
  });

  it('rejects a live inherited lease belonging to a different project', () => {
    const fixture = createFixture();
    const target = createFixture();
    const targetLease = spawnSync(
      'bash',
      [leaseScript, 'docker-start', '--', 'true'],
      { env: target.environment, encoding: 'utf8', timeout: commandTimeoutMs },
    );
    expect(targetLease.status, targetLease.stderr).toBe(0);
    const result = spawnSync(
      'bash',
      [
        leaseScript,
        'docker-start',
        '--',
        'env',
        `COMPOSE_PROJECT_NAME=${target.environment.COMPOSE_PROJECT_NAME}`,
        'bash',
        hostScript,
      ],
      { env: fixture.environment, encoding: 'utf8', timeout: commandTimeoutMs },
    );
    expect(result.status, result.stderr).toBe(75);
    expect(result.stderr).toContain('requires the inherited lease descriptor');
    expect(fs.existsSync(fixture.files.dockerLog)).toBe(false);
  });

  it.each(['absent', 'running', 'stopped'] as const)(
    'holds the lease through init, app cleanup, and restoration of %s MinIO',
    async (minioState) => {
      const fixture = createFixture(minioState);
      const contender = createFixture();
      const environment = {
        ...contender.environment,
        COMPOSE_PROJECT_NAME: fixture.environment.COMPOSE_PROJECT_NAME,
      };
      const host = spawn('bash', [hostScript], {
        env: fixture.environment,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const observedHost = observeChild(host, fixture.files.dockerLog);
      const expectExclusion = () => {
        const result = spawnSync(
          'bash',
          [leaseScript, 'docker-stop', '--', 'true'],
          { env: environment, encoding: 'utf8', timeout: commandTimeoutMs },
        );
        expect(result.status, result.stderr).toBe(75);
        expect(result.stderr).toContain('operation=host-e2e-webserver');
      };
      try {
        await waitForFile(fixture.files.initReady, observedHost);
        expectExclusion();
        fs.writeFileSync(fixture.files.initRelease, 'release');
        await waitForFile(fixture.files.appReady, observedHost);
        expectExclusion();
        const otherProject = spawnSync(
          'bash',
          [leaseScript, 'docker-stop', '--', 'true'],
          {
            env: contender.environment,
            encoding: 'utf8',
            timeout: commandTimeoutMs,
          },
        );
        expect(otherProject.status, otherProject.stderr).toBe(0);
        expect(host.kill('SIGTERM')).toBe(true);
        await waitForFile(fixture.files.appStopping, observedHost);
        expectExclusion();
        fs.writeFileSync(fixture.files.appRelease, 'release');
        if (minioState !== 'running') {
          await waitForFile(fixture.files.restoreReady, observedHost);
          expectExclusion();
          fs.writeFileSync(fixture.files.restoreRelease, 'release');
        }
        expect(
          await finishChild(observedHost),
          observedHost.diagnostics(),
        ).toEqual({ code: 143, signal: null });
        const log = fs.readFileSync(fixture.files.dockerLog, 'utf8');
        expect(log).toContain('compose run --rm --no-deps minio-init');
        if (minioState === 'absent')
          expect(log).toContain('rm --force minio-container');
        if (minioState === 'stopped')
          expect(log).toContain('stop --time 10 minio-container');
        if (minioState === 'running')
          expect(log).not.toMatch(/(?:stop --time|rm --force)/u);
        const next = spawnSync(
          'bash',
          [leaseScript, 'docker-stop', '--', 'true'],
          { env: environment, encoding: 'utf8', timeout: commandTimeoutMs },
        );
        expect(next.status, next.stderr).toBe(0);
      } finally {
        releaseFixture(fixture);
        if (host.exitCode === null && host.signalCode === null)
          host.kill('SIGTERM');
        await finishChild(observedHost);
      }
    },
  );
});
