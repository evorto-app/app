import { afterEach, describe, expect, it } from '@effect/vitest';
import { parse } from 'dotenv';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveInvocationEnvironment } from './runtime-environment';

const runtimeScript = path.join(
  process.cwd(),
  'helpers/testing/runtime-environment.ts',
);
const leaseScript = path.join(
  process.cwd(),
  'helpers/testing/with-docker-project-lease.sh',
);
const localDatabaseModule = path.join(
  process.cwd(),
  'helpers/local-database-preflight.ts',
);
const bunExecutable = 'bun';

interface CommandResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stderr: string;
  readonly stdout: string;
}

interface RunningCommand {
  readonly child: ChildProcess;
  readonly completed: Promise<CommandResult>;
}

const fixtureDirectories: string[] = [];
const runningCommands: RunningCommand[] = [];

const createFixture = () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-runtime-invocation-test-'),
  );
  fixtureDirectories.push(directory);
  const cwd = path.join(directory, 'worktree with spaces');
  const temporaryDirectory = path.join(directory, 'tmp');
  const home = path.join(directory, 'home');
  for (const target of [cwd, temporaryDirectory, home]) fs.mkdirSync(target);
  return { cwd, directory, home, temporaryDirectory };
};

const addPackageScripts = (fixture: ReturnType<typeof createFixture>) => {
  const packageJson: unknown = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
  );
  if (
    typeof packageJson !== 'object' ||
    packageJson === null ||
    !('scripts' in packageJson) ||
    typeof packageJson.scripts !== 'object' ||
    packageJson.scripts === null
  )
    throw new Error('Expected package scripts');
  const scripts: Record<string, string> = {};
  for (const name of ['env:run', 'docker:webserver']) {
    const script: unknown = Reflect.get(packageJson.scripts, name);
    if (typeof script !== 'string')
      throw new Error(`Expected ${name} package script`);
    scripts[name] = script;
  }
  fs.writeFileSync(
    path.join(fixture.cwd, 'package.json'),
    JSON.stringify({
      name: 'evorto-runtime-invocation-fixture',
      private: true,
      scripts,
    }),
  );
  const testingDirectory = path.join(fixture.cwd, 'helpers/testing');
  fs.mkdirSync(testingDirectory, { recursive: true });
  fs.symlinkSync(
    runtimeScript,
    path.join(testingDirectory, 'runtime-environment.ts'),
  );
  fs.symlinkSync(
    leaseScript,
    path.join(testingDirectory, 'with-docker-project-lease.sh'),
  );
  fs.copyFileSync(
    path.join(process.cwd(), 'bunfig.toml'),
    path.join(fixture.cwd, 'bunfig.toml'),
  );
  return testingDirectory;
};

const environmentFor = (
  fixture: ReturnType<typeof createFixture>,
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({
  APP_HOST_PORT: '4301',
  BUN_RUNTIME_TRANSPILER_CACHE_PATH: '0',
  COMPOSE_PROJECT_NAME: 'evorto-invocation-test',
  HOME: fixture.home,
  MAILPIT_HOST_PORT: '10101',
  MINIO_CONSOLE_HOST_PORT: '9501',
  MINIO_HOST_PORT: '9101',
  PATH: process.env['PATH'],
  POSTGRES_DB: 'appdb',
  POSTGRES_HOST_PORT: '56001',
  POSTGRES_PASSWORD: 'synthetic-password',
  POSTGRES_USER: 'synthetic-user',
  TEST_DIRECTORY: fixture.directory,
  TMPDIR: fixture.temporaryDirectory,
  ...overrides,
});

const invocationArguments = (...command: string[]) => [
  '--no-env-file',
  runtimeScript,
  '--run',
  '--',
  ...command,
];

const startCommand = (
  executable: string,
  arguments_: string[],
  cwd: string,
  environment: NodeJS.ProcessEnv,
  detached = false,
): RunningCommand => {
  const child = spawn(executable, arguments_, {
    cwd,
    detached,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk;
  });
  const completed = new Promise<CommandResult>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) =>
      resolve({ code, signal, stderr, stdout }),
    );
  });
  const command = { child, completed };
  runningCommands.push(command);
  return command;
};

const waitForFile = async (file: string, command: RunningCommand) => {
  const deadline = Date.now() + 5000;
  while (!fs.existsSync(file)) {
    if (command.child.exitCode !== null || command.child.signalCode !== null) {
      const result = await command.completed;
      throw new Error(`Command exited before ${file}: ${result.stderr}`);
    }
    if (Date.now() >= deadline)
      throw new Error(`Timed out waiting for ${file}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const finishCommand = async (command: RunningCommand) => {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      command.completed,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          command.child.kill('SIGKILL');
          reject(
            new Error('Runtime invocation did not exit within five seconds'),
          );
        }, 5000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
};

const captureEnvironmentSource = `
const fs = require('node:fs');
const path = require('node:path');
const capture = () => {
  return {
    databaseUrl: process.env.DATABASE_URL,
    project: process.env.COMPOSE_PROJECT_NAME,
    appPort: process.env.APP_HOST_PORT,
    ready: process.env.EVORTO_RUNTIME_ENV_READY,
    pid: process.pid,
  };
};
`;

afterEach(async () => {
  const directories = fixtureDirectories.splice(0);
  for (const directory of directories)
    fs.writeFileSync(path.join(directory, 'release'), 'release');
  for (const command of runningCommands.splice(0)) {
    if (command.child.exitCode === null && command.child.signalCode === null)
      command.child.kill('SIGTERM');
    await finishCommand(command);
  }
  for (const directory of directories)
    fs.rmSync(directory, { force: true, recursive: true });
});

describe('runtime environment invocation', () => {
  it('preserves process, shared, generated, and base precedence while expanding values', () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.cwd, '.env'),
      'BASE_ONLY=base\nGENERATED_WINS=base\nLOCAL_WINS=base\nPROCESS_WINS=base\nEXPANDED_BASE=${ROOT}/base\n',
    );
    fs.writeFileSync(
      path.join(fixture.cwd, '.env.dev.local'),
      'LOCAL_WINS=shared\nPROCESS_WINS=shared\nEXPANDED_SHARED=${ROOT}/shared\n',
    );
    fs.writeFileSync(
      path.join(fixture.cwd, '.env.dev'),
      'STALE=must-not-load\n',
    );
    const environment = {
      PROCESS_WINS: 'process',
      ROOT: 'https://synthetic.example',
      UNDEFINED_VALUE: undefined,
    };

    const resolved = resolveInvocationEnvironment(
      fixture.cwd,
      {
        GENERATED_WINS: 'generated',
        LOCAL_WINS: 'generated',
        PROCESS_WINS: 'generated',
      },
      environment,
    );

    expect(resolved).toMatchObject({
      BASE_ONLY: 'base',
      EXPANDED_BASE: 'https://synthetic.example/base',
      EXPANDED_SHARED: 'https://synthetic.example/shared',
      GENERATED_WINS: 'generated',
      LOCAL_WINS: 'shared',
      PROCESS_WINS: 'process',
    });
    expect(resolved).not.toHaveProperty('STALE');
    expect(resolved).not.toHaveProperty('UNDEFINED_VALUE');
    expect(environment).toEqual({
      PROCESS_WINS: 'process',
      ROOT: 'https://synthetic.example',
      UNDEFINED_VALUE: undefined,
    });
  });

  it('keeps exported dollar signs and backslashes literal even when the generated value matches', () => {
    const fixture = createFixture();
    const password = 'synthetic-$MISSING/${MISSING}/\\$MISSING';
    fs.writeFileSync(
      path.join(fixture.cwd, '.env'),
      'POSTGRES_PASSWORD=base-password\n',
    );
    fs.writeFileSync(
      path.join(fixture.cwd, '.env.dev.local'),
      'SHARED_VALUE=shared\n',
    );

    for (const generatedPassword of ['generated-password', password]) {
      const resolved = resolveInvocationEnvironment(
        fixture.cwd,
        { POSTGRES_PASSWORD: generatedPassword },
        { POSTGRES_PASSWORD: password },
      );

      expect(resolved['POSTGRES_PASSWORD']).toBe(password);
    }
  });

  it('keeps concurrent and nested invocations isolated after standalone regeneration', async () => {
    const fixture = createFixture();
    addPackageScripts(fixture);
    fs.writeFileSync(
      path.join(fixture.cwd, '.env.dev'),
      'COMPOSE_PROJECT_NAME=stale-project\n',
      { mode: 0o600 },
    );
    const nestedScript = path.join(fixture.directory, 'nested.cjs');
    const parentScript = path.join(fixture.directory, 'parent.cjs');
    fs.writeFileSync(
      nestedScript,
      `${captureEnvironmentSource}\nprocess.stdout.write(JSON.stringify(capture()));\n`,
    );
    fs.writeFileSync(
      parentScript,
      `${captureEnvironmentSource}
const { spawnSync } = require('node:child_process');
const before = capture();
fs.writeFileSync(path.join(process.env.TEST_DIRECTORY, process.env.TEST_ID + '.ready'), JSON.stringify(before));
const timer = setInterval(() => {
  if (!fs.existsSync(path.join(process.env.TEST_DIRECTORY, 'release'))) return;
  clearInterval(timer);
  const nested = spawnSync('bun', [
    '--no-env-file', 'run', 'env:run', '--',
    process.execPath, process.env.TEST_NESTED_SCRIPT,
  ], { cwd: process.cwd(), env: process.env, encoding: 'utf8' });
  if (nested.status !== 0) throw new Error(nested.stderr || 'Nested invocation failed');
  fs.writeFileSync(
    path.join(process.env.TEST_DIRECTORY, process.env.TEST_ID + '.json'),
    JSON.stringify({ before, after: capture(), nested: JSON.parse(nested.stdout) }),
  );
}, 10);
`,
    );

    const invocations = [
      { appPort: '4301', databasePort: '56001', id: 'first' },
      { appPort: '4302', databasePort: '56002', id: 'second' },
    ].map((invocation) => {
      const project = `evorto-${invocation.id}`;
      const command = startCommand(
        bunExecutable,
        [
          '--no-env-file',
          'run',
          'env:run',
          '--',
          process.execPath,
          parentScript,
        ],
        fixture.cwd,
        environmentFor(fixture, {
          APP_HOST_PORT: invocation.appPort,
          COMPOSE_PROJECT_NAME: project,
          POSTGRES_HOST_PORT: invocation.databasePort,
          TEST_ID: invocation.id,
          TEST_NESTED_SCRIPT: nestedScript,
        }),
      );
      return { ...invocation, command, project };
    });
    for (const invocation of invocations) {
      const ready = path.join(fixture.directory, `${invocation.id}.ready`);
      await waitForFile(ready, invocation.command);
      const record: unknown = JSON.parse(fs.readFileSync(ready, 'utf8'));
      expect(record).toMatchObject({
        project: invocation.project,
        ready: 'true',
      });
    }

    const regenerated = spawnSync(
      bunExecutable,
      ['--no-env-file', runtimeScript],
      {
        cwd: fixture.cwd,
        encoding: 'utf8',
        env: environmentFor(fixture, {
          APP_HOST_PORT: '4303',
          COMPOSE_PROJECT_NAME: 'evorto-third',
          POSTGRES_HOST_PORT: '56003',
        }),
        timeout: 5000,
      },
    );
    expect(regenerated.status, regenerated.stderr).toBe(0);
    const generatedFile = path.join(fixture.cwd, '.env.dev');
    expect(parse(fs.readFileSync(generatedFile))).toMatchObject({
      COMPOSE_PROJECT_NAME: 'evorto-third',
      POSTGRES_HOST_PORT: '56003',
    });
    expect(fs.statSync(generatedFile).mode & 0o777).toBe(0o600);
    expect(
      fs
        .readdirSync(fixture.cwd)
        .filter((name) => name.startsWith('.env.dev-')),
    ).toEqual([]);

    fs.writeFileSync(path.join(fixture.directory, 'release'), 'release');
    for (const invocation of invocations) {
      const result = await finishCommand(invocation.command);
      expect(result.code, result.stderr).toBe(0);
      const record: unknown = JSON.parse(
        fs.readFileSync(
          path.join(fixture.directory, `${invocation.id}.json`),
          'utf8',
        ),
      );
      const expected = {
        appPort: invocation.appPort,
        databaseUrl: `postgresql://synthetic-user:synthetic-password@localhost:${invocation.databasePort}/appdb?sslmode=disable`,
        project: invocation.project,
        ready: 'true',
      };
      expect(record).toMatchObject({
        after: expected,
        before: expected,
        nested: expected,
      });
    }
    expect(fs.readdirSync(fixture.temporaryDirectory)).toEqual([]);
  });

  it('preserves an explicit remote database URL so local preflight rejects it before connecting', () => {
    const fixture = createFixture();
    const validationScript = path.join(fixture.directory, 'validate.ts');
    fs.writeFileSync(
      validationScript,
      `import { resolveLocalDatabaseEnvironment } from ${JSON.stringify(localDatabaseModule)};\nresolveLocalDatabaseEnvironment();\n`,
    );
    const result = spawnSync(
      bunExecutable,
      invocationArguments(bunExecutable, '--no-env-file', validationScript),
      {
        cwd: fixture.cwd,
        encoding: 'utf8',
        env: environmentFor(fixture, {
          DATABASE_URL:
            'postgresql://synthetic:synthetic@remote.invalid:5432/appdb',
        }),
        timeout: 5000,
      },
    );

    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain(
      'Refusing to operate on non-local database host',
    );
    expect(fs.readdirSync(fixture.temporaryDirectory)).toEqual([]);
    expect(fs.existsSync(path.join(fixture.cwd, '.env.dev'))).toBe(false);
  });

  it.each([0, 23])(
    'preserves child exit status %i without writing invocation environment files',
    (status) => {
      const fixture = createFixture();
      const childScript = path.join(fixture.directory, 'exit.cjs');
      fs.writeFileSync(
        childScript,
        `${captureEnvironmentSource}
const captured = capture();
process.stdout.write(JSON.stringify(captured));
process.stderr.write('synthetic child diagnostic');
process.exit(Number(process.env.TEST_EXIT_CODE));
`,
      );
      const result = spawnSync(
        bunExecutable,
        invocationArguments(process.execPath, childScript),
        {
          cwd: fixture.cwd,
          encoding: 'utf8',
          env: environmentFor(fixture, {
            TEST_EXIT_CODE: String(status),
          }),
          timeout: 5000,
        },
      );

      expect(result.status, result.stderr).toBe(status);
      expect(result.stderr).toBe('synthetic child diagnostic');
      const captured: unknown = JSON.parse(result.stdout);
      expect(captured).toMatchObject({ ready: 'true' });
      expect(fs.readdirSync(fixture.temporaryDirectory)).toEqual([]);
      expect(fs.readdirSync(fixture.cwd)).toEqual([]);
    },
  );

  it('rejects an unavailable child executable without writing runtime files', () => {
    const fixture = createFixture();
    const result = spawnSync(
      bunExecutable,
      invocationArguments(path.join(fixture.directory, 'missing-command')),
      {
        cwd: fixture.cwd,
        encoding: 'utf8',
        env: environmentFor(fixture),
        timeout: 5000,
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Command not found:');
    expect(fs.readdirSync(fixture.temporaryDirectory)).toEqual([]);
    expect(fs.readdirSync(fixture.cwd)).toEqual([]);
  });

  it('rejects environment resolution inside a held lease before running its payload', () => {
    const fixture = createFixture();
    addPackageScripts(fixture);
    const payloadFile = path.join(fixture.directory, 'payload-ran');
    const environment = environmentFor(fixture, {
      TEST_PAYLOAD_FILE: payloadFile,
    });
    const result = spawnSync(
      'bash',
      [
        leaseScript,
        'database-studio',
        '--',
        bunExecutable,
        '--no-env-file',
        'run',
        'env:run',
        '--',
        process.execPath,
        '-e',
        "require('node:fs').writeFileSync(process.env.TEST_PAYLOAD_FILE, 'unexpected')",
      ],
      { cwd: fixture.cwd, encoding: 'utf8', env: environment, timeout: 5000 },
    );
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'Run env:run before acquiring the Docker project lease',
    );
    expect(fs.existsSync(payloadFile)).toBe(false);
    const next = spawnSync(
      'bash',
      [leaseScript, 'database-reset', '--', 'true'],
      {
        cwd: fixture.cwd,
        encoding: 'utf8',
        env: environment,
        timeout: 1000,
      },
    );
    expect(next.status, next.stderr).toBe(0);
  });

  it.each([
    { delivery: 'process', signal: 'SIGTERM' },
    { delivery: 'group', signal: 'SIGINT' },
  ] as const)(
    'keeps the actual package lifecycle lease during delayed $delivery $signal cleanup',
    async ({ delivery, signal }) => {
      const fixture = createFixture();
      const testingDirectory = addPackageScripts(fixture);
      fs.writeFileSync(
        path.join(testingDirectory, 'runtime-preflight.ts'),
        `
import fs from 'node:fs';
import path from 'node:path';
if (process.argv.at(-1) !== 'docker' || process.env.EVORTO_RUNTIME_ENV_READY !== 'true') process.exit(62);
fs.writeFileSync(path.join(process.env.TEST_DIRECTORY, 'preflight'), 'passed');
`,
      );
      fs.writeFileSync(
        path.join(testingDirectory, 'docker-webserver.sh'),
        String.raw`#!/usr/bin/env bash
set -euo pipefail
[[ "$EVORTO_RUNTIME_ENV_READY" = true ]]
[[ -f "$TEST_DIRECTORY/preflight" ]]
: >&9
worker_pid=''
cleanup_started=false
cleanup() {
  if [[ "$cleanup_started" = true ]]; then return; fi
  cleanup_started=true
  trap - EXIT HUP INT TERM
  if [[ -n "$worker_pid" ]]; then
    kill "$worker_pid" 2>/dev/null || true
    wait "$worker_pid" 2>/dev/null || true
  fi
  printf '%s\n' started >> "$TEST_DIRECTORY/cleanup"
  while [[ ! -f "$TEST_DIRECTORY/release" ]]; do sleep 0.02; done
  printf '%s\n' completed >> "$TEST_DIRECTORY/cleanup"
  exit 29
}
trap cleanup HUP INT TERM
sleep 600 &
worker_pid=$!
printf '%s\n' ready > "$TEST_DIRECTORY/ready"
wait "$worker_pid" || true
`,
        { mode: 0o700 },
      );
      const environment = environmentFor(fixture);
      const command = startCommand(
        bunExecutable,
        [
          '--no-env-file',
          'run',
          'env:run',
          '--',
          bunExecutable,
          '--no-env-file',
          'run',
          'docker:webserver',
        ],
        fixture.cwd,
        environment,
        delivery === 'group',
      );
      const leaseAttempt = () =>
        spawnSync('bash', [leaseScript, 'database-reset', '--', 'true'], {
          cwd: fixture.cwd,
          encoding: 'utf8',
          env: environment,
          timeout: 1000,
        });
      const expectContestedLease = () => {
        const contender = leaseAttempt();
        expect(contender.status, contender.stderr).toBe(75);
        expect(contender.stderr).toContain('operation=docker-webserver');
      };
      await waitForFile(path.join(fixture.directory, 'ready'), command);
      expect(
        fs.readFileSync(path.join(fixture.directory, 'preflight'), 'utf8'),
      ).toBe('passed');
      expectContestedLease();
      if (delivery === 'group') {
        if (command.child.pid === undefined)
          throw new Error('Expected an owned process group');
        process.kill(-command.child.pid, signal);
      } else command.child.kill(signal);
      const cleanupFile = path.join(fixture.directory, 'cleanup');
      await waitForFile(cleanupFile, command);
      expect(fs.readFileSync(cleanupFile, 'utf8')).toBe('started\n');
      expectContestedLease();
      fs.writeFileSync(path.join(fixture.directory, 'release'), 'release');
      const result = await finishCommand(command);
      expect(fs.readFileSync(cleanupFile, 'utf8')).toBe('started\ncompleted\n');
      if (delivery === 'group') {
        expect(result.code).toBeNull();
        expect(result.signal).toBe(signal);
      } else {
        expect(result.code, result.stderr).toBe(29);
        expect(result.signal).toBeNull();
      }
      const next = leaseAttempt();
      expect(next.status, next.stderr).toBe(0);
    },
  );
});
