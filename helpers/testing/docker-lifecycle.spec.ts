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
const ownedDescriptors = new Set<number>();
const retainDescriptor = (descriptor: number) => {
  ownedDescriptors.add(descriptor);
  return descriptor;
};
const closeDescriptor = (descriptor: number) => {
  fs.closeSync(descriptor);
  ownedDescriptors.delete(descriptor);
};
const childProcesses: {
  child: ChildProcess;
  closed: Promise<void>;
  isClosed: () => boolean;
  errors: Error[];
}[] = [];

const trackChild = (child: ChildProcess) => {
  const errors: Error[] = [];
  let isClosed = false;
  const closed = new Promise<void>((resolve) => {
    child.once('close', () => {
      isClosed = true;
      resolve();
    });
  });
  child.on('error', (error) => errors.push(error));
  child.stdout?.resume();
  child.stderr?.resume();
  childProcesses.push({ child, closed, errors, isClosed: () => isClosed });
  return closed;
};

const createPermissionDeniedSignalPreload = () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-wall-clock-timeout-'),
  );
  temporaryDirectories.push(directory);
  const preloadPath = path.join(directory, 'permission-denied-signal.mjs');

  fs.writeFileSync(
    preloadPath,
    String.raw`const originalKill = process.kill.bind(process);
let denied = false;

process.kill = (pid, signal) => {
  if (pid < 0 && signal !== 'SIGKILL' && !denied) {
    denied = true;
    const error = new Error('Synthetic live-group signal permission denial');
    error.name = 'SystemError';
    error.code = 'EPERM';
    throw error;
  }

  return originalKill(pid, signal);
};
`,
  );

  return { directory, preloadPath };
};

const createFakeDocker = ({
  downFailures = 0,
  downStatus = 1,
  holdDown = false,
  remainingContainerChecks = 0,
  remainingNetworkChecks = 0,
  remainingVolumeChecks = 0,
  upBehavior = 'exit',
  upStatus = 0,
}: {
  downFailures?: number;
  downStatus?: number;
  holdDown?: boolean;
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
  const upSignalTrap =
    upBehavior === 'exit'
      ? ''
      : `
if [[ "$*" == 'compose up --no-build --abort-on-container-failure' ]]; then
  trap 'printf "compose up terminated\\n" >> "$DOCKER_LOG"; exit 143' TERM INT HUP
fi
`;
  const waitBlock =
    upBehavior === 'wait-with-descendant'
      ? `
if [[ "$*" == 'compose up --no-build --abort-on-container-failure' ]]; then
  bash -c 'trap "" HUP INT TERM; printf "%s" "$$" > "$DOCKER_LOG.up-descendant-pid"; while true; do sleep 0.05; done' &
  wait "$!"
fi
`
      : upBehavior === 'wait'
        ? `
if [[ "$*" == 'compose up --no-build --abort-on-container-failure' ]]; then
  while true; do sleep 0.05; done
fi
`
        : '';

  fs.writeFileSync(
    executablePath,
    String.raw`#!/usr/bin/env bash
${upSignalTrap}printf '%s\n' "$*" >> "$DOCKER_LOG"
if [[ "$*" == 'compose ps --all --quiet minio' ]]; then
  if [[ "$FAKE_HOST_MINIO_STATE" != missing || -f "$DOCKER_LOG.host-created" ]]; then
    printf '%s\n' minio-container
  fi
  exit 0
fi
if [[ "$*" == 'compose up --detach --no-deps minio' ]]; then
  printf '%s' created > "$DOCKER_LOG.host-created"
  exit 0
fi
if [[ "$1" == 'compose' && "$2" == 'ps' && "$3" == '--all' && "$4" == '-q' ]]; then
  service="$5"
  if [[ "$service" == "$FAKE_PS_FAILURE_SERVICE" ]]; then
    exit "$FAKE_PS_FAILURE_STATUS"
  fi
  if [[ "$service" != "$FAKE_MISSING_SERVICE" ]]; then
    printf '%s-container\n' "$service"
  fi
  exit 0
fi
if [[ "$*" == 'compose down --timeout 60 --remove-orphans --volumes' ]]; then
  if [[ "$FAKE_HOLD_DOWN" == true ]]; then
    printf '%s' ready > "$DOCKER_LOG.down-ready"
    while [[ ! -f "$DOCKER_LOG.down-release" ]]; do sleep 0.02; done
  fi
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
  elif [[ "$format" == *'.State.Running'* ]]; then
    if [[ "$FAKE_HOST_MINIO_STATE" == running ]]; then
      printf 'true\n'
    else
      printf 'false\n'
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
if [[ "$1" == 'start' && "$2" == "$FAKE_START_FAILURE_SERVICE-container" ]]; then
  exit "$FAKE_START_FAILURE_STATUS"
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
      FAKE_HOLD_DOWN: String(holdDown),
      FAKE_FAILED_SETUP_SERVICE: '',
      FAKE_MISSING_HEALTHCHECK_SERVICE: '',
      FAKE_MISSING_SERVICE: '',
      FAKE_PS_FAILURE_SERVICE: '',
      FAKE_PS_FAILURE_STATUS: '1',
      FAKE_REMAINING_CONTAINER_CHECKS: String(remainingContainerChecks),
      FAKE_REMAINING_NETWORK_CHECKS: String(remainingNetworkChecks),
      FAKE_REMAINING_VOLUME_CHECKS: String(remainingVolumeChecks),
      FAKE_START_FAILURE_SERVICE: '',
      FAKE_START_FAILURE_STATUS: '1',
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
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
        return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Process ${pid} remained alive after group termination`);
};

afterEach(async () => {
  const cleanupErrors: Error[] = [];
  for (const descriptor of ownedDescriptors) {
    try {
      closeDescriptor(descriptor);
    } catch (error) {
      cleanupErrors.push(
        new Error('Could not close an owned fixture descriptor', {
          cause: error,
        }),
      );
    }
  }
  for (const owned of childProcesses) {
    if (
      !owned.isClosed() &&
      owned.child.exitCode === null &&
      owned.child.signalCode === null
    ) {
      try {
        if (!owned.child.kill('SIGTERM')) {
          cleanupErrors.push(
            new Error('Could not request owned fixture cancellation'),
          );
        }
      } catch (error) {
        cleanupErrors.push(
          new Error('Owned fixture cancellation failed', { cause: error }),
        );
      }
    }
  }
  await Promise.all(
    childProcesses.map(async (owned) => {
      // A deadline is a recorded failure, never permission to abandon a live
      // supervisor and remove files still used by its command/descendants.
      const timer = setTimeout(() => {
        cleanupErrors.push(
          new Error('Owned fixture close/drain exceeded eight seconds'),
        );
      }, 8000);
      await owned.closed;
      clearTimeout(timer);
      cleanupErrors.push(...owned.errors);
    }),
  );
  childProcesses.length = 0;
  for (const directory of temporaryDirectories) {
    try {
      fs.rmSync(directory, { force: true, recursive: true });
    } catch (error) {
      cleanupErrors.push(
        new Error(`Could not remove fixture directory ${directory}`, {
          cause: error,
        }),
      );
    }
  }
  temporaryDirectories.length = 0;
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      'Docker lifecycle fixture cleanup failed',
    );
  }
}, 15000);

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

  it.each([
    { exitCode: 129, signal: 'SIGHUP' as const },
    { exitCode: 130, signal: 'SIGINT' as const },
    { exitCode: 143, signal: 'SIGTERM' as const },
  ])(
    'preserves exit code $exitCode when its live-group $signal delivery is denied',
    async ({ exitCode, signal }) => {
      const { directory, preloadPath } = createPermissionDeniedSignalPreload();
      const readyPath = path.join(directory, 'ready');
      const stderrChunks: Buffer[] = [];
      const child = spawn(
        'bun',
        [
          '--preload',
          preloadPath,
          wallClockTimeoutScript,
          '0',
          '2',
          'bash',
          '-c',
          String.raw`trap 'exit 0' HUP INT TERM
printf 'ready\n' > "$1"
while true; do sleep 0.05; done`,
          'signal-child',
          readyPath,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      const closed = trackChild(child);
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

      await waitForFileContents(readyPath);
      const exitPromise = new Promise<{
        code: null | number;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        child.once('exit', (code, childSignal) =>
          resolve({ code, signal: childSignal }),
        );
      });

      expect(child.kill(signal)).toBe(true);
      const exit = await exitPromise;
      await closed;
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      expect(exit).toEqual({ code: exitCode, signal: null });
      expect(stderr).toContain(
        'Could not signal the live supervisor process group',
      );
      expect(stderr).toContain('Synthetic live-group signal permission denial');
      expect(stderr).not.toContain('SystemError');
    },
  );

  it('preserves timeout status when live-group timeout signal delivery is denied', () => {
    const { preloadPath } = createPermissionDeniedSignalPreload();
    const result = spawnSync(
      'bun',
      [
        '--preload',
        preloadPath,
        wallClockTimeoutScript,
        '1',
        '2',
        'bash',
        '-c',
        "trap 'exit 0' TERM; while :; do sleep 0.05; done",
      ],
      { encoding: 'utf8', timeout: 5000 },
    );

    expect(result.status).toBe(124);
    expect(result.stderr).toContain(
      'Could not signal the live supervisor process group',
    );
    expect(result.stderr).toContain(
      'Command exceeded its 1-second wall-clock timeout',
    );
    expect(result.stderr).not.toContain('SystemError');
  });

  it.each([
    { behavior: 'resistant', expectedCode: 124, trap: 'trap "" TERM' },
    {
      behavior: 'settles before deadline',
      expectedCode: 143,
      trap: "trap 'exit 0' TERM",
    },
  ])(
    'preserves deadline precedence when the signalled command is $behavior',
    async ({ expectedCode, trap }) => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'evorto-timeout-precedence-'),
      );
      temporaryDirectories.push(directory);
      const readyPath = path.join(directory, 'ready');
      const stderrChunks: Buffer[] = [];
      const child = spawn(
        'bun',
        [
          wallClockTimeoutScript,
          '2',
          '3',
          'bash',
          '-c',
          `${trap}\nprintf 'ready\\n' > "$1"\nwhile true; do sleep 0.05; done`,
          'precedence-child',
          readyPath,
        ],
        { stdio: ['ignore', 'ignore', 'pipe'] },
      );
      const closed = trackChild(child);
      child.stderr?.on('data', (chunk: Buffer) => stderrChunks.push(chunk));
      await waitForFileContents(readyPath);
      const startedAt = Date.now();
      expect(child.kill('SIGTERM')).toBe(true);
      await closed;
      const elapsedMs = Date.now() - startedAt;
      const stderr = Buffer.concat(stderrChunks).toString('utf8');

      expect(child.exitCode).toBe(expectedCode);
      expect(child.signalCode).toBeNull();
      expect(elapsedMs).toBeGreaterThanOrEqual(3000);
      // Restarting the three-second grace at the two-second command deadline
      // would instead keep this resistant command alive for about five seconds.
      expect(elapsedMs).toBeLessThan(4500);
      if (expectedCode === 124) {
        expect(stderr).toContain(
          'Command exceeded its 2-second wall-clock timeout.',
        );
      } else {
        expect(stderr).not.toContain('wall-clock timeout');
      }
    },
    10000,
  );

  it('preserves zero status, argument boundaries, stdin and separate output streams', () => {
    const result = spawnSync(
      'bun',
      [
        wallClockTimeoutScript,
        '2',
        '0',
        'bash',
        '-c',
        String.raw`IFS= read -r input
printf '%s|%s|%s|%s\n' "$input" "$1" "$2" "$3"
printf 'diagnostic\n' >&2`,
        'argument-child',
        'two words',
        '',
        '*literal*',
      ],
      { encoding: 'utf8', input: 'input words\n', timeout: 5000 },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('input words|two words||*literal*\n');
    expect(result.stderr).toBe('diagnostic\n');
  });

  it.each([
    { controlText: 'INT\nTERM\n', expectedCode: 130 },
    { controlText: 'HUP\nINT\n', expectedCode: 129 },
    { controlText: '', expectedCode: 143 },
  ])(
    'settles resistant descendants through owned control with status $expectedCode',
    async ({ controlText, expectedCode }) => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'evorto-owned-control-'),
      );
      temporaryDirectories.push(directory);
      const readyPath = path.join(directory, 'ready');
      const signalsPath = path.join(directory, 'signals');
      const preloadPath = path.join(directory, 'owned-signal.mjs');
      fs.writeFileSync(
        preloadPath,
        String.raw`import { appendFileSync } from 'node:fs';
const originalKill = process.kill.bind(process);
process.kill = (pid, signal) => {
  if (pid < 0) {
    if (pid !== -process.pid) throw new Error('Signal escaped the live supervisor group');
    appendFileSync(process.env['OWNED_SIGNAL_LOG'], String(signal) + '\n');
  }
  return originalKill(pid, signal);
};
`,
      );
      const fifoPath = path.join(directory, 'control');
      const createFifo = spawnSync('mkfifo', ['-m', '600', fifoPath], {
        encoding: 'utf8',
      });
      expect(createFifo.status).toBe(0);
      const writer = retainDescriptor(
        fs.openSync(fifoPath, fs.constants.O_RDWR | fs.constants.O_NONBLOCK),
      );
      const reader = retainDescriptor(
        fs.openSync(fifoPath, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK),
      );
      const child = spawn(
        'bun',
        [
          '--preload',
          preloadPath,
          wallClockTimeoutScript,
          '0',
          '1',
          'bash',
          '-c',
          String.raw`trap 'exit 0' HUP INT TERM
bash -c 'trap "" HUP INT TERM; printf "%s" "$$" > "$1"; while true; do sleep 0.05; done' descendant "$1" &
wait "$!"`,
          'leader',
          readyPath,
        ],
        {
          env: {
            ...process.env,
            EVORTO_WALL_CLOCK_CONTROL_FD: '3',
            EVORTO_WALL_CLOCK_CONTROL_PATH: fifoPath,
            OWNED_SIGNAL_LOG: signalsPath,
          },
          stdio: ['pipe', 'pipe', 'pipe', reader],
        },
      );
      const closed = trackChild(child);
      closeDescriptor(reader);
      let descendantPid = 0;
      let startedAt = Date.now();
      const operationErrors: Error[] = [];
      try {
        descendantPid = Number(await waitForFileContents(readyPath));
        startedAt = Date.now();
        fs.writeSync(writer, controlText);
      } catch (error) {
        operationErrors.push(
          new Error('Owned cancellation scenario failed', { cause: error }),
        );
      }
      try {
        closeDescriptor(writer);
      } catch (error) {
        operationErrors.push(
          new Error('Owned cancellation writer cleanup failed', {
            cause: error,
          }),
        );
      }
      if (operationErrors.length > 0) {
        throw new AggregateError(
          operationErrors,
          'Owned cancellation scenario and cleanup failed',
        );
      }
      await closed;
      expect(child.exitCode).toBe(expectedCode);
      expect(child.signalCode).toBeNull();
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1000);
      expect(Date.now() - startedAt).toBeLessThan(4000);
      const expectedSignal =
        expectedCode === 130
          ? 'SIGINT'
          : expectedCode === 129
            ? 'SIGHUP'
            : 'SIGTERM';
      expect(fs.readFileSync(signalsPath, 'utf8').trim().split('\n')).toEqual([
        expectedSignal,
        'SIGKILL',
      ]);
      await waitForProcessExit(descendantPid);
    },
  );

  it('rejects a cancellation path that differs from its retained FIFO', () => {
    const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'evorto-fifo-identity-'),
    );
    temporaryDirectories.push(directory);
    const retainedPath = path.join(directory, 'retained');
    const otherPath = path.join(directory, 'other');
    for (const fifoPath of [retainedPath, otherPath]) {
      const result = spawnSync('mkfifo', ['-m', '600', fifoPath], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
    }
    retainDescriptor(
      fs.openSync(retainedPath, fs.constants.O_RDWR | fs.constants.O_NONBLOCK),
    );
    const reader = retainDescriptor(
      fs.openSync(
        retainedPath,
        fs.constants.O_RDONLY | fs.constants.O_NONBLOCK,
      ),
    );
    const result = spawnSync(
      'bun',
      [
        wallClockTimeoutScript,
        '0',
        '0',
        'bun',
        '-e',
        'setInterval(() => {}, 1000)',
      ],
      {
        encoding: 'utf8',
        timeout: 5000,
        env: {
          ...process.env,
          EVORTO_WALL_CLOCK_CONTROL_FD: '3',
          EVORTO_WALL_CLOCK_CONTROL_PATH: otherPath,
        },
        stdio: ['ignore', 'ignore', 'pipe', reader],
      },
    );

    expect(result.status).toBe(143);
    expect(result.stderr).toContain(
      'Cancellation path does not match the retained FIFO',
    );
  });

  it.each(['acknowledgement-lost', 'parent-disconnected'])(
    'bounds private settlement when %s',
    (mode) => {
      const directory = fs.mkdtempSync(
        path.join(os.tmpdir(), 'evorto-supervisor-ipc-'),
      );
      temporaryDirectories.push(directory);
      const launcherPath = path.join(directory, 'launcher.ts');
      const readyPath = path.join(directory, 'ready');
      fs.writeFileSync(
        launcherPath,
        String.raw`const helperPath = process.argv[2];
const readyPath = process.argv[4];
if (!helperPath || !readyPath) throw new Error('Missing private fixture paths');
const disconnect = process.argv[3] === 'parent-disconnected';
const child = Bun.spawn([
  process.execPath, helperPath, '--internal-wall-clock-supervisor', '0', '0',
  process.execPath, '-e', disconnect
    ? 'const ready = process.env.SUPERVISOR_READY_FILE; if (!ready) throw new Error("Missing ready path"); await Bun.write(ready, "ready"); setInterval(() => {}, 1000)'
    : 'process.exit(0)',
], {
  env: { ...process.env, SUPERVISOR_READY_FILE: readyPath },
  detached: true, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit',
  ipc(message: unknown) { console.log(JSON.stringify(message)); },
});
const errors: Error[] = [];
if (disconnect) {
  try {
    const deadline = Date.now() + 3000;
    while (!(await Bun.file(readyPath).exists())) {
      if (Date.now() >= deadline) throw new Error('Command never became ready');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  } catch (error) {
    errors.push(new Error('Private IPC scenario failed', { cause: error }));
  }
  try { child.disconnect(); }
  catch (error) { errors.push(new Error('Private IPC disconnect failed', { cause: error })); }
}
await child.exited;
console.log(child.signalCode);
if (errors.length) throw new AggregateError(errors, 'Private IPC fixture failed');
`,
      );
      const startedAt = Date.now();
      const result = spawnSync(
        'bun',
        [launcherPath, wallClockTimeoutScript, mode, readyPath],
        {
          encoding: 'utf8',
          timeout: 5000,
        },
      );

      expect(result.status).toBe(0);
      expect(result.stdout).toContain('SIGKILL');
      expect(Date.now() - startedAt).toBeLessThan(4000);
      if (mode === 'acknowledgement-lost') {
        expect(result.stdout).toContain('"exitCode":0');
        expect(result.stderr).toContain(
          'Supervisor result acknowledgement exceeded 1000 milliseconds.',
        );
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1000);
      } else {
        expect(result.stderr).not.toContain('acknowledgement exceeded');
      }
    },
  );

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

  it('surfaces a bounded Docker inspection failure during resume', () => {
    const { environment, logPath } = createFakeDocker();
    const result = spawnSync('bash', [resumeScript], {
      encoding: 'utf8',
      env: {
        ...environment,
        FAKE_PS_FAILURE_SERVICE: 'minio',
        FAKE_PS_FAILURE_STATUS: '124',
      },
    });

    expect(result.status).toBe(124);
    expect(result.stderr).toContain(
      'Docker inspection for existing minio container exceeded its 10-second wall-clock limit.',
    );
    expect(result.stderr).toContain('Current Docker Compose state:');
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

  it('preserves worker startup failure and does not start the web application', () => {
    const { environment, logPath } = createFakeDocker();
    const result = spawnSync('bash', [resumeScript], {
      encoding: 'utf8',
      env: {
        ...environment,
        FAKE_START_FAILURE_SERVICE: 'worker',
        FAKE_START_FAILURE_STATUS: '37',
      },
    });

    expect(result.status).toBe(37);
    expect(result.stderr).toContain(
      'Docker startup for background worker failed with status 37.',
    );
    expect(result.stderr).toContain('Current Docker Compose state:');
    expect(
      fs
        .readFileSync(logPath, 'utf8')
        .trim()
        .split('\n')
        .filter((command) => command.startsWith('start ')),
    ).toEqual([
      'start db-container minio-container mailpit-container',
      'start stripe-container',
      'start worker-container',
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
    const closed = trackChild(child);

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
    await closed;

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

  it('finishes verified teardown and holds its lease when SIGTERM arrives during SIGINT cleanup', async () => {
    const { environment, logPath } = createFakeDocker({
      holdDown: true,
      upBehavior: 'wait',
    });
    const leaseScript = path.join(
      process.cwd(),
      'helpers/testing/with-docker-project-lease.sh',
    );
    const ownedEnvironment = {
      ...environment,
      FAKE_MISSING_SERVICE: 'db',
      TMPDIR: path.dirname(logPath),
    };
    const child = spawn(
      'bash',
      [leaseScript, 'docker-webserver', '--', 'bash', webserverScript],
      {
        env: ownedEnvironment,
        stdio: 'pipe',
      },
    );
    trackChild(child);
    const exited = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });
    const acquireLease = () =>
      spawnSync('bash', [leaseScript, 'docker-stop', '--', 'true'], {
        env: ownedEnvironment,
        encoding: 'utf8',
        timeout: 1000,
      });
    let exit:
      { code: number | null; signal: NodeJS.Signals | null } | undefined;
    try {
      await waitForText(
        logPath,
        'compose up --no-build --abort-on-container-failure',
      );
      expect(child.kill('SIGINT')).toBe(true);
      await waitForFileContents(`${logPath}.down-ready`);
      expect(acquireLease().status).toBe(75);
      expect(child.kill('SIGTERM')).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(child.exitCode).toBeNull();
      expect(child.signalCode).toBeNull();
      expect(acquireLease().status).toBe(75);
    } finally {
      fs.writeFileSync(`${logPath}.down-release`, 'release');
      exit = await exited;
    }
    expect(exit).toEqual({ code: 130, signal: null });
    const next = acquireLease();
    expect(next.status, next.stderr).toBe(0);
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

  it.each([
    { state: 'missing', restoration: 'rm --force minio-container' },
    { state: 'stopped', restoration: 'stop --time 10 minio-container' },
    { state: 'running', restoration: undefined },
  ])(
    'finishes host app cleanup before restoring $state MinIO after repeated shutdown signals',
    async ({ state, restoration }) => {
      const { environment, logPath } = createFakeDocker();
      const directory = path.dirname(logPath);
      const releasePath = path.join(directory, 'release-app');
      const descendantPath = path.join(directory, 'app-descendant.cjs');
      fs.writeFileSync(
        descendantPath,
        `
const fs = require('node:fs');
process.once('SIGTERM', () => {
  fs.appendFileSync(process.env.DOCKER_LOG, 'descendant-cleanup-started\\n');
  const timer = setInterval(() => {
    if (!fs.existsSync(process.env.HOST_APP_RELEASE)) return;
    clearInterval(timer);
    fs.appendFileSync(process.env.DOCKER_LOG, 'descendant-stopped\\n');
    process.exit(0);
  }, 10);
});
setInterval(() => {}, 1000);
fs.writeFileSync(process.env.HOST_DESCENDANT_PID, String(process.pid));
`,
      );
      fs.writeFileSync(
        path.join(directory, 'bun'),
        `#!${process.execPath}
const fs = require('node:fs');
const { spawn } = require('node:child_process');
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(['run', 'dev:ng', 'serve', '--port', '4301', '--allowed-hosts'])) process.exit(64);
const descendant = spawn(process.execPath, [process.env.HOST_DESCENDANT_SCRIPT], { stdio: 'inherit' });
process.once('SIGTERM', () => {
  fs.appendFileSync(process.env.DOCKER_LOG, 'app-cleanup-started\\n');
  descendant.kill('SIGTERM');
});
descendant.once('close', () => {
  fs.appendFileSync(process.env.DOCKER_LOG, 'app-stopped\\n');
  process.exit(0);
});
fs.writeFileSync(process.env.HOST_APP_PID, String(process.pid));
`,
        { mode: 0o700 },
      );
      fs.writeFileSync(path.join(directory, 'curl'), '#!/bin/sh\nexit 0\n', {
        mode: 0o700,
      });
      const appPidPath = path.join(directory, 'app-pid');
      const descendantPidPath = path.join(directory, 'descendant-pid');
      const child = spawn(
        'bash',
        [path.join(process.cwd(), 'helpers/testing/host-e2e-webserver.sh')],
        {
          env: {
            ...environment,
            APP_HOST_PORT: '4301',
            MINIO_HOST_PORT: '9101',
            FAKE_HOST_MINIO_STATE: state,
            HOST_APP_RELEASE: releasePath,
            HOST_APP_PID: appPidPath,
            HOST_DESCENDANT_PID: descendantPidPath,
            HOST_DESCENDANT_SCRIPT: descendantPath,
          },
          stdio: 'pipe',
        },
      );
      const closed = trackChild(child);
      const exited = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        child.once('exit', (code, signal) => resolve({ code, signal }));
      });
      let appPid: number | undefined;
      let descendantPid: number | undefined;
      try {
        appPid = Number(await waitForFileContents(appPidPath));
        descendantPid = Number(await waitForFileContents(descendantPidPath));
        expect(child.kill('SIGINT')).toBe(true);
        await waitForText(logPath, 'descendant-cleanup-started');
        expect(child.kill('SIGTERM')).toBe(true);
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(child.exitCode).toBeNull();
        expect(child.signalCode).toBeNull();
        expect(process.kill(appPid, 0)).toBe(true);
        expect(process.kill(descendantPid, 0)).toBe(true);
        const duringCleanup = fs.readFileSync(logPath, 'utf8');
        expect(duringCleanup).not.toContain('app-stopped');
        expect(duringCleanup).not.toContain('rm --force minio-container');
        expect(duringCleanup).not.toContain('stop --time 10 minio-container');
      } finally {
        fs.writeFileSync(releasePath, 'release');
        await closed;
      }
      expect(await exited).toEqual({ code: 130, signal: null });
      if (appPid === undefined || descendantPid === undefined)
        throw new Error('Missing owned app process IDs');
      await waitForProcessExit(appPid);
      await waitForProcessExit(descendantPid);
      const lifecycleLog = fs.readFileSync(logPath, 'utf8').trim().split('\n');
      expect(
        lifecycleLog.slice(lifecycleLog.indexOf('app-cleanup-started')),
      ).toEqual([
        'app-cleanup-started',
        'descendant-cleanup-started',
        'descendant-stopped',
        'app-stopped',
        ...(restoration ? [restoration] : []),
      ]);
    },
  );

  it('surfaces a failed teardown without retrying', async () => {
    const { environment, logPath } = createFakeDocker({
      downFailures: 1,
      downStatus: 19,
      upBehavior: 'wait',
    });
    const child = spawn('bash', [webserverScript], {
      env: { ...environment, FAKE_MISSING_SERVICE: 'db' },
      stdio: 'pipe',
    });
    const closed = trackChild(child);

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
    await closed;

    expect(exit).toEqual({ code: 19, signal: null });
    expect(fs.readFileSync(logPath, 'utf8').trim().split('\n')).toEqual([
      'compose ps --all -q db',
      'compose build',
      'compose up --no-build --abort-on-container-failure',
      'compose up terminated',
      'compose down --timeout 60 --remove-orphans --volumes',
    ]);
  });

  it('surfaces incomplete teardown without retrying', async () => {
    const { environment, logPath } = createFakeDocker({
      remainingVolumeChecks: 1,
      upBehavior: 'wait',
    });
    const child = spawn('bash', [webserverScript], {
      env: { ...environment, FAKE_MISSING_SERVICE: 'db' },
      stdio: 'pipe',
    });
    const closed = trackChild(child);

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
    await closed;

    expect(exit).toEqual({ code: 1, signal: null });
    const log = fs.readFileSync(logPath, 'utf8');
    expect(
      log.match(/compose down --timeout 60 --remove-orphans --volumes/gu),
    ).toHaveLength(1);
    expect(log.match(/network ls --quiet/gu)).toHaveLength(1);
    expect(log.match(/volume ls --quiet/gu)).toHaveLength(1);
  });

  it('preserves the command failure alongside cancellation-channel removal failure', () => {
    const { environment, logPath } = createFakeDocker({ upStatus: 37 });
    const directory = path.dirname(logPath);
    const removePath = path.join(directory, 'rm');
    fs.writeFileSync(
      removePath,
      String.raw`#!/usr/bin/env bash
count_file="$DOCKER_LOG.remove-count"
count=0
if [[ -f "$count_file" ]]; then count="$(<"$count_file")"; fi
count=$((count + 1))
printf '%s' "$count" > "$count_file"
if ((count >= 2)); then exit 29; fi
exec /bin/rm "$@"
`,
    );
    fs.chmodSync(removePath, 0o700);
    const result = spawnSync('bash', [webserverScript], {
      encoding: 'utf8',
      env: { ...environment, FAKE_MISSING_SERVICE: 'db', TMPDIR: directory },
    });

    expect(result.status).toBe(37);
    expect(result.stderr).toContain(
      'Could not remove the Compose cancellation directory',
    );
    expect(result.stderr).toContain(
      'Compose command status 37 was followed by cancellation-channel cleanup failure',
    );
    expect(result.stderr).toContain(
      'Cleanup followed original status 37 (cancellation 1, teardown 0)',
    );
    const log = fs.readFileSync(logPath, 'utf8');
    expect(
      log.match(/compose down --timeout 60 --remove-orphans --volumes/gu),
    ).toHaveLength(1);
    expect(log).toContain('volume ls --quiet');
  });

  it('reports acquisition and removal failures before starting a Compose command', () => {
    const { environment, logPath } = createFakeDocker();
    const directory = path.dirname(logPath);
    for (const name of ['mkfifo', 'rm']) {
      const executablePath = path.join(directory, name);
      fs.writeFileSync(executablePath, '#!/usr/bin/env bash\nexit 17\n');
      fs.chmodSync(executablePath, 0o700);
    }
    const result = spawnSync('bash', [webserverScript], {
      encoding: 'utf8',
      env: { ...environment, FAKE_MISSING_SERVICE: 'db', TMPDIR: directory },
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'Could not create the Compose cancellation channel',
    );
    expect(result.stderr).toContain(
      'Could not remove the Compose cancellation directory',
    );
    const log = fs.readFileSync(logPath, 'utf8');
    expect(log).not.toContain('compose build');
    expect(log).not.toContain('compose up');
    expect(
      log.match(/compose down --timeout 60 --remove-orphans --volumes/gu),
    ).toHaveLength(1);
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
