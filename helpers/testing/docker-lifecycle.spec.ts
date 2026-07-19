import { afterEach, describe, expect, it } from '@effect/vitest';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const resumeScript = path.join(
  process.cwd(),
  'helpers/testing/docker-resume.sh',
);
const webserverScript = path.join(
  process.cwd(),
  'helpers/testing/docker-webserver.sh',
);
const wallClockTimeoutScript = path.join(
  process.cwd(),
  'helpers/testing/run-with-wall-clock-timeout.ts',
);

const temporaryDirectories: string[] = [];
const childProcesses: ChildProcess[] = [];

const createFakeDocker = ({
  downFailures = 0,
  downStatus = 1,
  remainingContainerChecks = 0,
  remainingNetworkChecks = 0,
  remainingVolumeChecks = 0,
  upBehavior = 'exit',
  upStatus = 0,
}: {
  downFailures?: number;
  downStatus?: number;
  remainingContainerChecks?: number;
  remainingNetworkChecks?: number;
  remainingVolumeChecks?: number;
  upBehavior?: 'exit' | 'wait' | 'wait-with-descendant';
  upStatus?: number;
} = {}) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-docker-lifecycle-'),
  );
  temporaryDirectories.push(directory);
  const logPath = path.join(directory, 'docker.log');
  const upDescendantPidPath = `${logPath}.up-descendant-pid`;
  const executablePath = path.join(directory, 'docker');
  const waitBlock =
    upBehavior === 'wait-with-descendant'
      ? `
if [[ "$*" == 'compose up --no-build --abort-on-container-failure' ]]; then
  trap 'printf "compose up terminated\\n" >> "$DOCKER_LOG"; exit 143' TERM INT HUP
  bash -c 'trap "" HUP INT TERM; while true; do sleep 0.05; done' &
  printf '%s' "$!" > "$DOCKER_LOG.up-descendant-pid"
  wait "$!"
fi
`
      : upBehavior === 'wait'
        ? `
if [[ "$*" == 'compose up --no-build --abort-on-container-failure' ]]; then
  trap 'printf "compose up terminated\\n" >> "$DOCKER_LOG"; exit 143' TERM INT HUP
  while true; do sleep 0.05; done
fi
`
        : '';

  fs.writeFileSync(
    executablePath,
    String.raw`#!/usr/bin/env bash
printf '%s\n' "$*" >> "$DOCKER_LOG"
if [[ "$1" == 'compose' && "$2" == 'ps' && "$3" == '--all' && "$4" == '-q' ]]; then
  service="$5"
  if [[ "$service" != "$FAKE_MISSING_SERVICE" ]]; then
    printf '%s-container\n' "$service"
  fi
  exit 0
fi
if [[ "$*" == 'compose down --timeout 60 --remove-orphans --volumes' ]]; then
  count_file="$DOCKER_LOG.down-count"
  count=0
  if [[ -f "$count_file" ]]; then
    count="$(<"$count_file")"
  fi
  count=$((count + 1))
  printf '%s' "$count" > "$count_file"
  if ((count <= FAKE_DOWN_FAILURES)); then
    exit "$FAKE_DOWN_STATUS"
  fi
  exit 0
fi
if [[ "$*" == ps\ --all\ --quiet\ --filter\ label=com.docker.compose.project=* ]]; then
  count_file="$DOCKER_LOG.container-count"
  count=0
  if [[ -f "$count_file" ]]; then
    count="$(<"$count_file")"
  fi
  count=$((count + 1))
  printf '%s' "$count" > "$count_file"
  if ((count <= FAKE_REMAINING_CONTAINER_CHECKS)); then
    printf 'container-still-present\n'
  fi
  exit 0
fi
if [[ "$*" == network\ ls\ --quiet\ --filter\ label=com.docker.compose.project=* ]]; then
  count_file="$DOCKER_LOG.network-count"
  count=0
  if [[ -f "$count_file" ]]; then
    count="$(<"$count_file")"
  fi
  count=$((count + 1))
  printf '%s' "$count" > "$count_file"
  if ((count <= FAKE_REMAINING_NETWORK_CHECKS)); then
    printf 'network-still-present\n'
  fi
  exit 0
fi
if [[ "$*" == volume\ ls\ --quiet\ --filter\ label=com.docker.compose.project=* ]]; then
  count_file="$DOCKER_LOG.volume-count"
  count=0
  if [[ -f "$count_file" ]]; then
    count="$(<"$count_file")"
  fi
  count=$((count + 1))
  printf '%s' "$count" > "$count_file"
  if ((count <= FAKE_REMAINING_VOLUME_CHECKS)); then
    printf 'volume-still-present\n'
  fi
  exit 0
fi
if [[ "$1" == 'inspect' ]]; then
  format="$3"
  container_id="$4"
  service="$(printf '%s' "$container_id" | sed 's/-container$//')"
  if [[ "$format" == *'.Config.Env'* ]]; then
    printf 'BRANCH_ID=%s\n' "$FAKE_CONTAINER_BRANCH_ID"
    printf 'DELETE_BRANCH=%s\n' "$FAKE_CONTAINER_DELETE_BRANCH"
  elif [[ "$format" == *'.State.ExitCode'* ]]; then
    if [[ "$service" == "$FAKE_FAILED_SETUP_SERVICE" ]]; then
      printf 'exited 1\n'
    else
      printf 'exited 0\n'
    fi
  elif [[ "$format" == *'.State.Health'* ]]; then
    if [[ "$service" == "$FAKE_MISSING_HEALTHCHECK_SERVICE" ]]; then
      printf 'missing-healthcheck\n'
    elif [[ "$service" == "$FAKE_UNHEALTHY_SERVICE" ]]; then
      printf 'unhealthy\n'
    else
      printf 'healthy\n'
    fi
  fi
  exit 0
fi
if [[ "$*" == 'compose build' ]]; then
  exit 0
fi
${waitBlock}if [[ "$*" == 'compose up --no-build --abort-on-container-failure' ]]; then
  exit "$FAKE_UP_STATUS"
fi
exit 0
`,
  );
  fs.chmodSync(executablePath, 0o700);

  return {
    environment: {
      ...process.env,
      COMPOSE_PROJECT_NAME: 'evorto-test-project',
      DOCKER_LOG: logPath,
      FAKE_CONTAINER_BRANCH_ID: '',
      FAKE_CONTAINER_DELETE_BRANCH: 'true',
      FAKE_DOWN_FAILURES: String(downFailures),
      FAKE_DOWN_STATUS: String(downStatus),
      FAKE_FAILED_SETUP_SERVICE: '',
      FAKE_MISSING_HEALTHCHECK_SERVICE: '',
      FAKE_MISSING_SERVICE: '',
      FAKE_REMAINING_CONTAINER_CHECKS: String(remainingContainerChecks),
      FAKE_REMAINING_NETWORK_CHECKS: String(remainingNetworkChecks),
      FAKE_REMAINING_VOLUME_CHECKS: String(remainingVolumeChecks),
      FAKE_UNHEALTHY_SERVICE: '',
      FAKE_UP_STATUS: String(upStatus),
      PATH: `${directory}:${process.env['PATH'] ?? ''}`,
    },
    logPath,
    upDescendantPidPath,
  };
};

const waitForText = async (
  filePath: string,
  expectedText: string,
): Promise<void> => {
  const deadline = Date.now() + 3000;

  while (Date.now() < deadline) {
    if (
      fs.existsSync(filePath) &&
      fs.readFileSync(filePath, 'utf8').includes(expectedText)
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${expectedText} in ${filePath}`);
};

const waitForFileContents = async (filePath: string): Promise<string> => {
  const deadline = Date.now() + 3000;

  while (Date.now() < deadline) {
    if (fs.existsSync(filePath)) {
      const contents = fs.readFileSync(filePath, 'utf8').trim();
      if (contents.length > 0) return contents;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for contents in ${filePath}`);
};

const waitForProcessExit = async (pid: number): Promise<void> => {
  const deadline = Date.now() + 3000;

  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Process ${pid} remained alive after group termination`);
};

afterEach(() => {
  for (const child of childProcesses) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  }
  childProcesses.length = 0;

  for (const directory of temporaryDirectories) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
  temporaryDirectories.length = 0;
});

describe('Docker Compose lifecycle wrappers', () => {
  it('enforces a portable wall-clock command deadline', () => {
    const startedAt = Date.now();
    const result = spawnSync(
      'bun',
      [
        wallClockTimeoutScript,
        '1',
        '0',
        'bash',
        '-c',
        "trap '' TERM; while :; do :; done",
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    const elapsedMs = Date.now() - startedAt;

    expect(result.status).toBe(124);
    expect(result.stderr).toContain(
      'Command exceeded its 1-second wall-clock timeout',
    );
    expect(elapsedMs).toBeGreaterThanOrEqual(1000);
    expect(elapsedMs).toBeLessThan(4000);
  });

  it('preserves command output and status before the wall-clock deadline', () => {
    const result = spawnSync(
      'bun',
      [
        wallClockTimeoutScript,
        '2',
        '1',
        'bash',
        '-c',
        "printf 'done\\n'; exit 37",
      ],
      { encoding: 'utf8', timeout: 5000 },
    );

    expect(result.status).toBe(37);
    expect(result.stdout).toBe('done\n');
    expect(result.stderr).toBe('');
  });

  it('ignores obsolete branch variables when resuming plain PostgreSQL', () => {
    const { environment, logPath } = createFakeDocker();
    const result = spawnSync('bash', [resumeScript], {
      encoding: 'utf8',
      env: {
        ...environment,
        BRANCH_ID: 'br-changed-after-container-stopped',
        DELETE_BRANCH: 'false',
      },
    });

    expect(result.status).toBe(0);
    expect(fs.readFileSync(logPath, 'utf8')).not.toContain('.Config.Env');
  }, 30_000);

  it.each([
    {
      environment: {
        FAKE_CONTAINER_BRANCH_ID: 'br-persistent',
        FAKE_CONTAINER_DELETE_BRANCH: 'true',
      },
      mode: 'an existing branch id',
    },
    {
      environment: {
        FAKE_CONTAINER_BRANCH_ID: '',
        FAKE_CONTAINER_DELETE_BRANCH: 'false',
      },
      mode: 'persistent branch creation',
    },
  ])(
    'resumes with $mode',
    ({ environment: overrides }) => {
      const { environment, logPath } = createFakeDocker();
      const result = spawnSync('bash', [resumeScript], {
        encoding: 'utf8',
        env: { ...environment, ...overrides },
      });

      expect(result.status).toBe(0);
      const resumeCommands = fs
        .readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .filter((command) => command.startsWith('start '));
      expect(resumeCommands).toEqual([
        'start db-container minio-container mailpit-container',
        'start stripe-container',
        'start worker-container',
        'start evorto-container',
      ]);
      expect(resumeCommands.join('\n')).not.toMatch(
        /db-expiration|db-setup|minio-init/u,
      );
      const lifecycleLog = fs.readFileSync(logPath, 'utf8');
      expect(lifecycleLog).toContain(
        'start stripe-container\ninspect --format {{if .State.Health}}{{.State.Health.Status}}{{else}}missing-healthcheck{{end}} stripe-container\nstart worker-container\nstart evorto-container',
      );
      expect(lifecycleLog).not.toContain('compose down');
      expect(lifecycleLog).not.toContain('volume ls');
    },
    30_000,
  );

  it('refuses to create a missing long-running service during resume', () => {
    const { environment, logPath } = createFakeDocker();
    const result = spawnSync('bash', [resumeScript], {
      encoding: 'utf8',
      env: {
        ...environment,
        FAKE_CONTAINER_BRANCH_ID: 'br-persistent',
        FAKE_MISSING_SERVICE: 'stripe',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no existing stripe container');
    expect(fs.readFileSync(logPath, 'utf8')).not.toContain('start ');
  });

  it('refuses to rerun an unsuccessfully completed one-shot service', () => {
    const { environment, logPath } = createFakeDocker();
    const result = spawnSync('bash', [resumeScript], {
      encoding: 'utf8',
      env: {
        ...environment,
        FAKE_CONTAINER_BRANCH_ID: 'br-persistent',
        FAKE_FAILED_SETUP_SERVICE: 'db-setup',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'existing db-setup container did not complete successfully',
    );
    expect(fs.readFileSync(logPath, 'utf8')).not.toContain('start ');
  });

  it('refuses to infer initialization when a one-shot container is missing', () => {
    const { environment, logPath } = createFakeDocker();
    const result = spawnSync('bash', [resumeScript], {
      encoding: 'utf8',
      env: {
        ...environment,
        FAKE_CONTAINER_BRANCH_ID: 'br-persistent',
        FAKE_MISSING_SERVICE: 'minio-init',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no existing minio-init container');
    expect(fs.readFileSync(logPath, 'utf8')).not.toContain('start ');
  });

  it('does not start Stripe or the app when retained infrastructure is unhealthy', () => {
    const { environment, logPath } = createFakeDocker();
    const result = spawnSync('bash', [resumeScript], {
      encoding: 'utf8',
      env: {
        ...environment,
        FAKE_CONTAINER_BRANCH_ID: 'br-persistent',
        FAKE_UNHEALTHY_SERVICE: 'db',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('db entered state unhealthy');
    expect(
      fs
        .readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .filter((command) => command.startsWith('start ')),
    ).toEqual(['start db-container minio-container mailpit-container']);
  });

  it('does not start the app until the retained Stripe listener is healthy', () => {
    const { environment, logPath } = createFakeDocker();
    const result = spawnSync('bash', [resumeScript], {
      encoding: 'utf8',
      env: {
        ...environment,
        FAKE_CONTAINER_BRANCH_ID: 'br-persistent',
        FAKE_UNHEALTHY_SERVICE: 'stripe',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stripe entered state unhealthy');
    expect(
      fs
        .readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .filter((command) => command.startsWith('start ')),
    ).toEqual([
      'start db-container minio-container mailpit-container',
      'start stripe-container',
    ]);
  });

  it('refuses a retained Stripe container without a signing-secret healthcheck', () => {
    const { environment, logPath } = createFakeDocker();
    const result = spawnSync('bash', [resumeScript], {
      encoding: 'utf8',
      env: {
        ...environment,
        FAKE_CONTAINER_BRANCH_ID: 'br-persistent',
        FAKE_MISSING_HEALTHCHECK_SERVICE: 'stripe',
      },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stripe container has no healthcheck');
    expect(
      fs
        .readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .filter((command) => command.startsWith('start ')),
    ).toEqual([
      'start db-container minio-container mailpit-container',
      'start stripe-container',
    ]);
  });

  it.each([
    {
      environment: {
        FAKE_CONTAINER_BRANCH_ID: 'br-persistent',
        FAKE_CONTAINER_DELETE_BRANCH: 'true',
      },
      mode: 'an explicit branch id',
    },
    {
      environment: {
        FAKE_CONTAINER_BRANCH_ID: '',
        FAKE_CONTAINER_DELETE_BRANCH: 'false',
      },
      mode: 'persistent branch creation',
    },
  ])(
    'refuses disposable Playwright ownership of a stopped stack with $mode',
    ({ environment: overrides }) => {
      const { environment, logPath } = createFakeDocker();
      const result = spawnSync('bash', [webserverScript], {
        encoding: 'utf8',
        env: { ...environment, ...overrides },
      });

      expect(result.status).toBe(3);
      expect(result.stderr).toContain(
        'Refusing disposable Playwright ownership because this project already has a PostgreSQL container',
      );
      const lifecycleLog = fs.readFileSync(logPath, 'utf8');
      expect(lifecycleLog).toContain('compose ps --all -q db');
      expect(lifecycleLog).not.toContain('inspect --format');
      expect(lifecycleLog).not.toContain('compose up');
      expect(lifecycleLog).not.toContain('compose down');
      expect(lifecycleLog).not.toContain('volume ls');
    },
  );

  it('terminates Compose up before removing the owned project', async () => {
    const { environment, logPath, upDescendantPidPath } = createFakeDocker({
      upBehavior: 'wait-with-descendant',
    });
    const child = spawn('bash', [webserverScript], {
      env: { ...environment, FAKE_MISSING_SERVICE: 'db' },
      stdio: 'pipe',
    });
    childProcesses.push(child);

    await waitForText(
      logPath,
      'compose up --no-build --abort-on-container-failure',
    );
    const descendantPid = Number(
      await waitForFileContents(upDescendantPidPath),
    );
    const exitPromise = new Promise<{
      code: null | number;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    child.kill('SIGTERM');
    const exit = await exitPromise;

    expect(exit).toEqual({ code: 143, signal: null });
    await waitForProcessExit(descendantPid);
    expect(fs.readFileSync(logPath, 'utf8').trim().split('\n')).toEqual([
      'compose ps --all -q db',
      'compose build',
      'compose up --no-build --abort-on-container-failure',
      'compose up terminated',
      'compose down --timeout 60 --remove-orphans --volumes',
      'ps --all --quiet --filter label=com.docker.compose.project=evorto-test-project',
      'network ls --quiet --filter label=com.docker.compose.project=evorto-test-project',
      'volume ls --quiet --filter label=com.docker.compose.project=evorto-test-project',
    ]);
  });

  it('retries a failed teardown and preserves the Playwright signal status after recovery', async () => {
    const { environment, logPath } = createFakeDocker({
      downFailures: 1,
      downStatus: 19,
      upBehavior: 'wait',
    });
    const child = spawn('bash', [webserverScript], {
      env: { ...environment, FAKE_MISSING_SERVICE: 'db' },
      stdio: 'pipe',
    });
    childProcesses.push(child);

    await waitForText(
      logPath,
      'compose up --no-build --abort-on-container-failure',
    );
    const exitPromise = new Promise<{
      code: null | number;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    child.kill('SIGTERM');
    const exit = await exitPromise;

    expect(exit).toEqual({ code: 143, signal: null });
    expect(fs.readFileSync(logPath, 'utf8').trim().split('\n')).toEqual([
      'compose ps --all -q db',
      'compose build',
      'compose up --no-build --abort-on-container-failure',
      'compose up terminated',
      'compose down --timeout 60 --remove-orphans --volumes',
      'compose down --timeout 60 --remove-orphans --volumes',
      'ps --all --quiet --filter label=com.docker.compose.project=evorto-test-project',
      'network ls --quiet --filter label=com.docker.compose.project=evorto-test-project',
      'volume ls --quiet --filter label=com.docker.compose.project=evorto-test-project',
    ]);
  });

  it('retries when verification finds a project volume and succeeds only after it is gone', async () => {
    const { environment, logPath } = createFakeDocker({
      remainingVolumeChecks: 1,
      upBehavior: 'wait',
    });
    const child = spawn('bash', [webserverScript], {
      env: { ...environment, FAKE_MISSING_SERVICE: 'db' },
      stdio: 'pipe',
    });
    childProcesses.push(child);

    await waitForText(
      logPath,
      'compose up --no-build --abort-on-container-failure',
    );
    const exitPromise = new Promise<{
      code: null | number;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    child.kill('SIGTERM');
    const exit = await exitPromise;

    expect(exit).toEqual({ code: 143, signal: null });
    const log = fs.readFileSync(logPath, 'utf8');
    expect(
      log.match(/compose down --timeout 60 --remove-orphans --volumes/gu),
    ).toHaveLength(2);
    expect(log.match(/network ls --quiet/gu)).toHaveLength(2);
    expect(log.match(/volume ls --quiet/gu)).toHaveLength(2);
  });

  it('returns the teardown failure instead of masking it with the Playwright signal status', async () => {
    const { environment, logPath } = createFakeDocker({
      downFailures: 2,
      downStatus: 19,
      upBehavior: 'wait',
    });
    const child = spawn('bash', [webserverScript], {
      env: { ...environment, FAKE_MISSING_SERVICE: 'db' },
      stdio: 'pipe',
    });
    childProcesses.push(child);
    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    await waitForText(
      logPath,
      'compose up --no-build --abort-on-container-failure',
    );
    const exitPromise = new Promise<{
      code: null | number;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    child.kill('SIGTERM');
    const exit = await exitPromise;

    expect(exit).toEqual({ code: 19, signal: null });
    expect(
      fs.readFileSync(logPath, 'utf8').match(/compose down/gu),
    ).toHaveLength(2);
    expect(Buffer.concat(stderrChunks).toString('utf8')).toContain(
      'Docker Compose teardown failed after 2 attempts',
    );
  });

  it('fails teardown when a project volume remains after both cleanup attempts', async () => {
    const { environment, logPath } = createFakeDocker({
      remainingVolumeChecks: 2,
      upBehavior: 'wait',
    });
    const child = spawn('bash', [webserverScript], {
      env: { ...environment, FAKE_MISSING_SERVICE: 'db' },
      stdio: 'pipe',
    });
    childProcesses.push(child);
    const stderrChunks: Buffer[] = [];
    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    await waitForText(
      logPath,
      'compose up --no-build --abort-on-container-failure',
    );
    const exitPromise = new Promise<{
      code: null | number;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    child.kill('SIGTERM');
    const exit = await exitPromise;

    expect(exit).toEqual({ code: 1, signal: null });
    expect(
      fs.readFileSync(logPath, 'utf8').match(/compose down/gu),
    ).toHaveLength(2);
    expect(Buffer.concat(stderrChunks).toString('utf8')).toContain(
      'Docker Compose teardown left project containers, networks, or volumes behind',
    );
  });

  it('preserves the fail-fast Compose exit status when verified cleanup succeeds', () => {
    const { environment, logPath } = createFakeDocker({ upStatus: 37 });
    const result = spawnSync('bash', [webserverScript], {
      encoding: 'utf8',
      env: { ...environment, FAKE_MISSING_SERVICE: 'db' },
    });

    expect(result.status).toBe(37);
    expect(fs.readFileSync(logPath, 'utf8').trim().split('\n')).toEqual([
      'compose ps --all -q db',
      'compose build',
      'compose up --no-build --abort-on-container-failure',
      'compose down --timeout 60 --remove-orphans --volumes',
      'ps --all --quiet --filter label=com.docker.compose.project=evorto-test-project',
      'network ls --quiet --filter label=com.docker.compose.project=evorto-test-project',
      'volume ls --quiet --filter label=com.docker.compose.project=evorto-test-project',
    ]);
  });
});
