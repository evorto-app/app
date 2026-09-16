import { afterEach, describe, expect, it } from '@effect/vitest';
import { parse } from 'dotenv';
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from 'pg';

import { resolveLocalDatabaseEnvironment } from '../local-database-preflight';

import {
  resolveInvocationEnvironment,
  resolveRuntimePorts,
} from './runtime-environment';

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
const fixtureProjects: string[] = [];
const userId = process.getuid?.();
if (userId === undefined)
  throw new Error('Runtime lease tests require a POSIX user');
const leaseRoot = path.join('/tmp', `evorto-docker-project-leases-${userId}`);

const createFixture = () => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-runtime-invocation-test-'),
  );
  fixtureDirectories.push(directory);
  const projectName = path.basename(directory).toLowerCase();
  fixtureProjects.push(projectName);
  const cwd = path.join(directory, 'worktree with spaces');
  const temporaryDirectory = path.join(directory, 'tmp');
  const home = path.join(directory, 'home');
  for (const target of [cwd, temporaryDirectory, home]) fs.mkdirSync(target);
  return { cwd, directory, home, projectName, temporaryDirectory };
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
  for (const name of [
    'env:run',
    'db:reset',
    'docker:webserver',
    'test:e2e',
    'test:e2e:check',
  ]) {
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
  COMPOSE_PROJECT_NAME: fixture.projectName,
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
    dockerDatabaseUrl: process.env.DOCKER_DATABASE_URL,
    integrationDatabaseUrl: process.env.POSTGRES_INTEGRATION_DATABASE_URL,
    databaseName: process.env.POSTGRES_DB,
    databaseUser: process.env.POSTGRES_USER,
    databasePassword: process.env.POSTGRES_PASSWORD,
    postgresPort: process.env.POSTGRES_HOST_PORT,
    baseUrl: process.env.BASE_URL,
    forwardReference: process.env.FORWARD_REFERENCE,
    baseUrlReference: process.env.BASE_URL_REFERENCE,
    ssrOrigin: process.env.SSR_RPC_ORIGIN,
    project: process.env.COMPOSE_PROJECT_NAME,
    appPort: process.env.APP_HOST_PORT,
    ready: process.env.EVORTO_RUNTIME_ENV_READY,
    baseOnly: process.env.BASE_ONLY,
    sharedOnly: process.env.SHARED_ONLY,
    unsupportedAutoFile: process.env.UNSUPPORTED_AUTO_FILE,
    pid: process.pid,
  };
};
`;

const captureInvocation = (
  fixture: ReturnType<typeof createFixture>,
  overrides: NodeJS.ProcessEnv,
) => {
  const result = spawnSync(
    bunExecutable,
    invocationArguments(
      process.execPath,
      '-e',
      `${captureEnvironmentSource}\nprocess.stdout.write(JSON.stringify(capture()));`,
    ),
    {
      cwd: fixture.cwd,
      encoding: 'utf8',
      env: environmentFor(fixture, overrides),
      timeout: 5000,
    },
  );
  expect(result.status, result.stderr).toBe(0);
  const captured: unknown = JSON.parse(result.stdout);
  return captured;
};

const addPlaywrightDispatchProbe = (
  fixture: ReturnType<typeof createFixture>,
) => {
  const testingDirectory = addPackageScripts(fixture);
  const binaryDirectory = path.join(fixture.directory, 'bin');
  fs.mkdirSync(binaryDirectory);
  const marker = path.join(fixture.directory, 'preflight-ran');
  fs.writeFileSync(
    path.join(testingDirectory, 'runtime-preflight.ts'),
    `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(marker)}, 'ran');\n`,
  );
  const playwright = path.join(binaryDirectory, 'playwright');
  fs.writeFileSync(
    playwright,
    `#!/usr/bin/env node\n${captureEnvironmentSource}\nprocess.stdout.write(JSON.stringify(capture()));\n`,
  );
  fs.chmodSync(playwright, 0o700);
  return { marker, path: `${binaryDirectory}:${process.env['PATH'] ?? ''}` };
};

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
  for (const project of fixtureProjects.splice(0)) {
    for (const suffix of ['lock', 'owner'])
      fs.rmSync(path.join(leaseRoot, `${project}.${suffix}`), { force: true });
  }
});

describe('runtime environment invocation', () => {
  it.each([
    {
      label: 'valid seed configuration',
      accountId: 'acct_fixture',
      nowIso: undefined,
      expectedStatus: 73,
      preflightError: undefined,
    },
    {
      label: 'missing seed account',
      accountId: undefined,
      nowIso: undefined,
      expectedStatus: 1,
      preflightError: 'STRIPE_TEST_ACCOUNT_ID',
    },
    {
      label: 'invalid seed date',
      accountId: 'acct_fixture',
      nowIso: 'not-an-iso-date',
      expectedStatus: 1,
      preflightError: 'Invalid E2E_NOW_ISO',
    },
  ])(
    'runs documented db:reset safely with $label',
    ({ accountId, nowIso, expectedStatus, preflightError }) => {
      const fixture = createFixture();
      addPackageScripts(fixture);
      const preflightMarker = path.join(
        fixture.directory,
        'seed-preflight.json',
      );
      const resetMarker = path.join(fixture.directory, 'validated-reset.json');
      const networkMarker = path.join(fixture.directory, 'network-attempt');
      const preload = path.join(fixture.directory, 'reset-boundary.mjs');
      fs.symlinkSync(
        path.join(process.cwd(), 'src'),
        path.join(fixture.cwd, 'src'),
      );
      fs.symlinkSync(
        path.join(process.cwd(), 'node_modules'),
        path.join(fixture.cwd, 'node_modules'),
      );
      fs.copyFileSync(
        path.join(process.cwd(), 'tsconfig.json'),
        path.join(fixture.cwd, 'tsconfig.json'),
      );
      for (const file of ['database.ts', 'reset-database-schema.ts']) {
        fs.symlinkSync(
          path.join(process.cwd(), 'helpers', file),
          path.join(fixture.cwd, 'helpers', file),
        );
      }
      fs.writeFileSync(
        preload,
        `
import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { spawnSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mock } from 'bun:test';
const denyConnection = () => {
  fs.writeFileSync(${JSON.stringify(networkMarker)}, 'blocked');
  throw new Error('Unexpected network access in reset command fixture');
};
net.Socket.prototype.connect = denyConnection;
net.connect = denyConnection;
net.createConnection = denyConnection;
tls.connect = denyConnection;
globalThis.fetch = denyConnection;
Bun.connect = denyConnection;
syncBuiltinESMExports();
if (process.argv.some((argument) => argument.endsWith('helpers/database.ts'))) {
  fs.writeFileSync(${JSON.stringify(preflightMarker)}, JSON.stringify({
    preflight: process.env.STAGING_SEED_PREFLIGHT_ONLY,
    confirmation: process.env.LOCAL_DATABASE_CONFIRM_RESET ?? null,
  }));
}
mock.module(${JSON.stringify(path.join(process.cwd(), 'helpers/testing/postgres-integration-database.ts'))}, () => ({
  ensureLocalPostgresIntegrationDatabase: async ({ databaseUrl }) => {
    const contender = spawnSync('bash', [${JSON.stringify(leaseScript)}, 'reset-fixture-contender', '--', 'true'], { env: process.env });
    fs.writeFileSync(${JSON.stringify(resetMarker)}, JSON.stringify({
      databaseUrl,
      confirmation: process.env.LOCAL_DATABASE_CONFIRM_RESET,
      preflight: process.env.STAGING_SEED_PREFLIGHT_ONLY ?? null,
      leaseHeld: process.env.EVORTO_DOCKER_PROJECT_LEASE_HELD,
      contenderStatus: contender.status,
    }));
    process.exit(73);
  },
}));
mock.module(${JSON.stringify(path.join(process.cwd(), 'helpers/testing/reset-public-schema.ts'))}, () => ({
  resetPublicSchema: async () => { throw new Error('Schema mutation must not run in this fixture'); },
}));
`,
      );
      const bunConfig = path.join(fixture.cwd, 'bunfig.toml');
      fs.writeFileSync(
        bunConfig,
        `preload = [${JSON.stringify(preload)}]\n${fs.readFileSync(bunConfig, 'utf8')}`,
      );
      const environment = environmentFor(fixture, {
        ...(accountId === undefined
          ? {}
          : { STRIPE_TEST_ACCOUNT_ID: accountId }),
        ...(nowIso === undefined ? {} : { E2E_NOW_ISO: nowIso }),
      });
      expect(environment['LOCAL_DATABASE_CONFIRM_RESET']).toBeUndefined();
      const result = spawnSync('bun', ['run', 'db:reset'], {
        cwd: fixture.cwd,
        env: environment,
        encoding: 'utf8',
        timeout: 10_000,
      });
      const output = `${result.stdout}\n${result.stderr}`;
      expect(result.error, output).toBeUndefined();
      expect(result.signal, output).toBeNull();
      expect(result.status, output).toBe(expectedStatus);
      expect(fs.existsSync(networkMarker)).toBe(false);
      expect(JSON.parse(fs.readFileSync(preflightMarker, 'utf8'))).toEqual({
        preflight: 'true',
        confirmation: null,
      });
      if (preflightError) {
        expect(output).toContain(preflightError);
        expect(fs.existsSync(resetMarker)).toBe(false);
      } else {
        expect(JSON.parse(fs.readFileSync(resetMarker, 'utf8'))).toEqual({
          databaseUrl:
            'postgresql://synthetic-user:synthetic-password@localhost:56001/appdb?sslmode=disable',
          confirmation: 'evorto-local-reset',
          preflight: null,
          leaseHeld: 'true',
          contenderStatus: 75,
        });
      }
    },
  );

  it.each([
    { callerPort: undefined, expectedPort: '4302' },
    { callerPort: '4303', expectedPort: '4303' },
  ])(
    'preserves dotenv precedence through the real outer bun run with caller port $callerPort',
    ({ callerPort, expectedPort }) => {
      const fixture = createFixture();
      const probe = addPlaywrightDispatchProbe(fixture);
      fs.writeFileSync(
        path.join(fixture.cwd, '.env'),
        'APP_HOST_PORT=invalid-base\nPOSTGRES_HOST_PORT=invalid-base\nDATABASE_URL=postgresql://base:base@remote.invalid/base\nBASE_ONLY=base-value\n',
      );
      fs.writeFileSync(
        path.join(fixture.cwd, '.env.dev.local'),
        'APP_HOST_PORT=4302\nPOSTGRES_HOST_PORT=56202\nPOSTGRES_DB=shared-db\nSHARED_ONLY=shared-value\n',
      );
      fs.writeFileSync(
        path.join(fixture.cwd, '.env.local'),
        'APP_HOST_PORT=invalid-auto-file\nUNSUPPORTED_AUTO_FILE=must-not-load\n',
      );
      const result = spawnSync(bunExecutable, ['run', 'test:e2e'], {
        cwd: fixture.cwd,
        encoding: 'utf8',
        env: environmentFor(fixture, {
          APP_HOST_PORT: callerPort,
          PATH: probe.path,
          POSTGRES_DB: undefined,
          POSTGRES_HOST_PORT: undefined,
        }),
        timeout: 5000,
      });
      expect(result.status, result.stderr).toBe(0);
      const captured: unknown = JSON.parse(result.stdout);
      expect(captured).toMatchObject({
        appPort: expectedPort,
        baseOnly: 'base-value',
        databaseName: 'shared-db',
        databaseUrl:
          'postgresql://synthetic-user:synthetic-password@localhost:56202/shared-db?sslmode=disable',
        postgresPort: '56202',
        sharedOnly: 'shared-value',
      });
      expect(captured).not.toHaveProperty('unsupportedAutoFile');
      expect(fs.existsSync(probe.marker)).toBe(true);
    },
  );

  it.each([
    {
      label: 'caller remote target',
      environment: {
        DATABASE_URL: 'postgresql://u:p@remote.invalid:56001/appdb',
      },
    },
    {
      label: 'shared remote target',
      sharedUrl: 'postgresql://u:p@remote.invalid:56001/appdb',
    },
    {
      label: 'wrong database name',
      environment: { DATABASE_URL: 'postgresql://u:p@localhost:56001/other' },
    },
    {
      label: 'another local project port',
      environment: { DATABASE_URL: 'postgresql://u:p@localhost:56002/appdb' },
    },
    {
      label: 'driver host query override',
      environment: {
        DATABASE_URL:
          'postgresql://u:p@localhost:56001/appdb?host=remote.invalid',
      },
    },
    {
      label: 'driver port query override',
      environment: {
        DATABASE_URL: 'postgresql://u:p@localhost:56001/appdb?port=56002',
      },
    },
    {
      label: 'reserved application database name',
      environment: { POSTGRES_DB: 'evorto_postgres_integration' },
    },
    {
      label: 'disabled local database acknowledgement',
      environment: { LOCAL_DATABASE: 'false' },
    },
  ])(
    'rejects $label before the outer package starts a child',
    ({ environment, sharedUrl }) => {
      const fixture = createFixture();
      const probe = addPlaywrightDispatchProbe(fixture);
      if (sharedUrl) {
        fs.writeFileSync(
          path.join(fixture.cwd, '.env.dev.local'),
          `DATABASE_URL=${sharedUrl}\n`,
        );
      }
      const result = spawnSync(bunExecutable, ['run', 'test:e2e:check'], {
        cwd: fixture.cwd,
        encoding: 'utf8',
        env: environmentFor(fixture, { ...environment, PATH: probe.path }),
        timeout: 5000,
      });
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stderr).toMatch(
        /DATABASE_URL|POSTGRES_DB|LOCAL_DATABASE|non-local database host/u,
      );
      expect(fs.existsSync(probe.marker)).toBe(false);
      expect(
        fs.existsSync(path.join(leaseRoot, `${fixture.projectName}.owner`)),
      ).toBe(false);
      expect(fs.existsSync(path.join(fixture.cwd, '.env.dev'))).toBe(false);
    },
  );

  it('preserves process, shared, generated, and base precedence while expanding values', () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.cwd, '.env'),
      'BASE_ONLY=base\nPOSTGRES_USER=base\nPOSTGRES_DB=base\nPROCESS_WINS=base\nEXPANDED_BASE=${ROOT}/base\n',
    );
    fs.writeFileSync(
      path.join(fixture.cwd, '.env.dev.local'),
      'POSTGRES_DB=shared\nPROCESS_WINS=shared\nEXPANDED_SHARED=${ROOT}/shared\n',
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

    const resolved = resolveInvocationEnvironment(fixture.cwd, environment);

    expect(resolved).toMatchObject({
      BASE_ONLY: 'base',
      EXPANDED_BASE: 'https://synthetic.example/base',
      EXPANDED_SHARED: 'https://synthetic.example/shared',
      POSTGRES_USER: 'evorto',
      POSTGRES_DB: 'shared',
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

    const resolved = resolveInvocationEnvironment(fixture.cwd, {
      POSTGRES_PASSWORD: password,
    });
    expect(resolved['POSTGRES_PASSWORD']).toBe(password);
    expect(decodeURIComponent(new URL(resolved['DATABASE_URL']).password)).toBe(
      password,
    );
  });

  it.each([
    {
      databaseName: ' shared database ',
      encodedDatabaseName: '%20shared%20database%20',
    },
    {
      databaseName: ' shared % ü database ',
      encodedDatabaseName: '%20shared%20%25%20%C3%BC%20database%20',
    },
  ])(
    'derives CLI URLs from shared inputs and validates the database target: $databaseName',
    ({ databaseName, encodedDatabaseName }) => {
      const fixture = createFixture();
      fs.writeFileSync(
        path.join(fixture.cwd, '.env'),
        'FORWARD_REFERENCE=${LATER_VALUE}\nBASE_URL_REFERENCE=${BASE_URL}/from-base-file\nLATER_VALUE=forward-value\nAPP_HOST_PORT=invalid-base\nPOSTGRES_HOST_PORT=invalid-base\nPOSTGRES_USER=base-user\nDATABASE_URL=postgresql://base:base@remote.invalid/base\n',
      );
      fs.writeFileSync(
        path.join(fixture.cwd, '.env.dev.local'),
        [
          'APP_HOST_PORT=04321',
          'POSTGRES_HOST_PORT=056321',
          'POSTGRES_USER=" shared user "',
          'POSTGRES_PASSWORD=" shared password "',
          `POSTGRES_DB="${databaseName}"`,
          'SSR_RPC_ORIGIN=${BASE_URL}',
        ].join('\n'),
      );
      const overrides = {
        APP_HOST_PORT: undefined,
        POSTGRES_HOST_PORT: undefined,
        POSTGRES_USER: undefined,
        POSTGRES_PASSWORD: undefined,
        POSTGRES_DB: undefined,
      };
      const expectedDatabaseUrl = `postgresql://%20shared%20user%20:%20shared%20password%20@localhost:56321/${encodedDatabaseName}?sslmode=disable`;
      expect(captureInvocation(fixture, overrides)).toMatchObject({
        appPort: '4321',
        forwardReference: 'forward-value',
        baseUrlReference: 'http://localhost:4321/from-base-file',
        baseUrl: 'http://localhost:4321',
        ssrOrigin: 'http://localhost:4321',
        postgresPort: '56321',
        databaseUser: ' shared user ',
        databasePassword: ' shared password ',
        databaseName,
        databaseUrl: expectedDatabaseUrl,
        integrationDatabaseUrl:
          'postgresql://%20shared%20user%20:%20shared%20password%20@localhost:56321/evorto_postgres_integration?sslmode=disable',
      });
      const guard = spawnSync(
        bunExecutable,
        invocationArguments(
          bunExecutable,
          '--no-env-file',
          '-e',
          `import { resolveLocalDatabaseEnvironment } from ${JSON.stringify(localDatabaseModule)}; resolveLocalDatabaseEnvironment();`,
        ),
        {
          cwd: fixture.cwd,
          encoding: 'utf8',
          env: environmentFor(fixture, overrides),
          timeout: 5000,
        },
      );
      expect(guard.status, guard.stderr).toBe(0);
      const snapshot = spawnSync(
        bunExecutable,
        ['--no-env-file', runtimeScript],
        {
          cwd: fixture.cwd,
          encoding: 'utf8',
          env: environmentFor(fixture, overrides),
          timeout: 5000,
        },
      );
      expect(snapshot.status, snapshot.stderr).toBe(0);
      expect(
        parse(fs.readFileSync(path.join(fixture.cwd, '.env.dev'))),
      ).toMatchObject({
        APP_HOST_PORT: '4321',
        BASE_URL: 'http://localhost:4321',
        POSTGRES_HOST_PORT: '56321',
        DATABASE_URL: expectedDatabaseUrl,
        POSTGRES_PASSWORD: ' shared password ',
      });
    },
  );

  it('keeps caller ports and literal credentials above shared settings in the executed command', () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.cwd, '.env.dev.local'),
      'APP_HOST_PORT=not-a-port\nPOSTGRES_HOST_PORT=not-a-port\nPOSTGRES_PASSWORD=shared\n',
    );
    const password = ' literal$MISSING/${MISSING}/\\$MISSING ';
    expect(
      captureInvocation(fixture, {
        APP_HOST_PORT: ' 04309 ',
        POSTGRES_HOST_PORT: ' 056309 ',
        POSTGRES_PASSWORD: password,
      }),
    ).toMatchObject({
      appPort: '4309',
      baseUrl: 'http://localhost:4309',
      ssrOrigin: 'http://localhost:4309',
      postgresPort: '56309',
      databasePassword: password,
      databaseUrl: `postgresql://synthetic-user:${encodeURIComponent(password)}@localhost:56309/appdb?sslmode=disable`,
      integrationDatabaseUrl: `postgresql://synthetic-user:${encodeURIComponent(password)}@localhost:56309/evorto_postgres_integration?sslmode=disable`,
    });
  });

  it('derives the container URL from literal credentials and ignores a supplied container URL', () => {
    const fixture = createFixture();
    const overrides = {
      DOCKER_DATABASE_URL: 'postgresql://wrong:wrong@remote.invalid/wrong',
      POSTGRES_DB: ' reports % ü ',
      POSTGRES_PASSWORD: ' password $MISSING ${MISSING} \\ @:/?#% ',
      POSTGRES_USER: ' user $MISSING ${MISSING} \\ @:/?#% ',
    };
    const resolved = resolveInvocationEnvironment(
      fixture.cwd,
      environmentFor(fixture, overrides),
    );
    const containerUrl = resolved['DOCKER_DATABASE_URL'];
    if (!containerUrl) throw new Error('Expected the generated container URL');
    // Construction parses the driver's final target without connecting.
    const client = new Client({ connectionString: containerUrl });
    expect(client.host).toBe('db');
    expect(client.port).toBe(5432);
    expect(client.user).toBe(overrides.POSTGRES_USER);
    expect(client.password).toBe(overrides.POSTGRES_PASSWORD);
    expect(client.database).toBe(overrides.POSTGRES_DB);
    expect(
      resolveLocalDatabaseEnvironment({
        ...resolved,
        DATABASE_URL: containerUrl,
      }),
    ).toEqual({ databaseUrl: containerUrl });
    expect(captureInvocation(fixture, overrides)).toMatchObject({
      dockerDatabaseUrl: containerUrl,
    });
  });

  it.each(['reports#1', 'reports/1', 'reports?1', 'reports$1'])(
    'rejects the unsupported literal database %s before publishing ownership',
    (databaseName) => {
      const fixture = createFixture();
      const payloadFile = path.join(fixture.directory, 'payload-ran');
      const environment = environmentFor(fixture, {
        POSTGRES_DB: databaseName,
        TEST_PAYLOAD_FILE: payloadFile,
      });
      for (const arguments_ of [
        ['--no-env-file', runtimeScript],
        invocationArguments(
          'bash',
          leaseScript,
          'docker-start',
          '--',
          process.execPath,
          '-e',
          "require('node:fs').writeFileSync(process.env.TEST_PAYLOAD_FILE, 'unexpected')",
        ),
      ]) {
        const result = spawnSync(bunExecutable, arguments_, {
          cwd: fixture.cwd,
          encoding: 'utf8',
          env: environment,
          timeout: 5000,
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain('configured local database');
        expect(fs.existsSync(payloadFile)).toBe(false);
        expect(fs.existsSync(path.join(fixture.cwd, '.env.dev'))).toBe(false);
        expect(
          fs.existsSync(path.join(leaseRoot, `${fixture.projectName}.owner`)),
        ).toBe(false);
      }
    },
  );

  it.each(['', ' \t '])(
    'treats blank caller ports %j as absent before shared values',
    (blank) => {
      const fixture = createFixture();
      fs.writeFileSync(
        path.join(fixture.cwd, '.env.dev.local'),
        'APP_HOST_PORT=4322\nPOSTGRES_HOST_PORT=56322\n',
      );
      expect(
        captureInvocation(fixture, {
          APP_HOST_PORT: blank,
          POSTGRES_HOST_PORT: blank,
        }),
      ).toMatchObject({
        appPort: '4322',
        postgresPort: '56322',
        baseUrl: 'http://localhost:4322',
        databaseUrl:
          'postgresql://synthetic-user:synthetic-password@localhost:56322/appdb?sslmode=disable',
      });
    },
  );

  it('replaces empty database inputs and blank shared ports with consistent generated defaults', () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.cwd, '.env.dev.local'),
      'APP_HOST_PORT=" "\nPOSTGRES_HOST_PORT=\nPOSTGRES_PASSWORD=shared\n',
    );
    const overrides = {
      APP_HOST_PORT: undefined,
      POSTGRES_HOST_PORT: undefined,
      POSTGRES_DB: '',
      POSTGRES_USER: '',
      POSTGRES_PASSWORD: '',
    };
    const ports = resolveRuntimePorts(
      fs.realpathSync(fixture.cwd),
      environmentFor(fixture, overrides),
    );
    expect(captureInvocation(fixture, overrides)).toMatchObject({
      appPort: String(ports.appHostPort),
      postgresPort: String(ports.postgresHostPort),
      baseUrl: `http://localhost:${ports.appHostPort}`,
      databaseUrl: `postgresql://evorto:evorto-local@localhost:${ports.postgresHostPort}/appdb?sslmode=disable`,
      databaseUser: 'evorto',
      databasePassword: 'evorto-local',
      databaseName: 'appdb',
    });
  });

  it('preserves safe explicit shared and caller URL overrides instead of replacing them with derived URLs', () => {
    const fixture = createFixture();
    fs.writeFileSync(
      path.join(fixture.cwd, '.env.dev.local'),
      'BASE_URL=https://shared.invalid\nSSR_RPC_ORIGIN=https://shared-rpc.invalid\n',
    );
    expect(
      captureInvocation(fixture, {
        BASE_URL: 'https://caller.invalid',
        DATABASE_URL: 'postgresql://explicit:literal@127.0.0.1:56001/appdb',
        POSTGRES_INTEGRATION_DATABASE_URL:
          'postgresql://explicit:literal@remote.invalid/integration',
      }),
    ).toMatchObject({
      baseUrl: 'https://caller.invalid',
      ssrOrigin: 'https://shared-rpc.invalid',
      databaseUrl: 'postgresql://explicit:literal@127.0.0.1:56001/appdb',
      integrationDatabaseUrl:
        'postgresql://explicit:literal@remote.invalid/integration',
    });
  });

  it.each([
    { name: 'APP_HOST_PORT', value: '4300junk', shared: false },
    { name: 'POSTGRES_HOST_PORT', value: 'invalid', shared: true },
    { name: 'APP_HOST_PORT', value: '1023', shared: true },
    { name: 'POSTGRES_HOST_PORT', value: '65536', shared: false },
  ])(
    'rejects malformed $name=$value before either CLI mode produces output',
    ({ name, value, shared }) => {
      const fixture = createFixture();
      const payloadFile = path.join(fixture.directory, 'payload-ran');
      if (shared)
        fs.writeFileSync(
          path.join(fixture.cwd, '.env.dev.local'),
          `${name}=${value}\n`,
        );
      const environment = environmentFor(fixture, {
        [name]: shared ? undefined : value,
        TEST_PAYLOAD_FILE: payloadFile,
      });
      for (const arguments_ of [
        ['--no-env-file', runtimeScript],
        invocationArguments(
          process.execPath,
          '-e',
          "require('node:fs').writeFileSync(process.env.TEST_PAYLOAD_FILE, 'unexpected')",
        ),
      ]) {
        const result = spawnSync(bunExecutable, arguments_, {
          cwd: fixture.cwd,
          encoding: 'utf8',
          env: environment,
          timeout: 5000,
        });
        expect(result.status).not.toBe(0);
        expect(result.stderr).toContain(
          `${name} must be a decimal port between 1024 and 65535`,
        );
        expect(fs.existsSync(payloadFile)).toBe(false);
        expect(fs.existsSync(path.join(fixture.cwd, '.env.dev'))).toBe(false);
        expect(
          fs
            .readdirSync(fixture.cwd)
            .filter((file) => file.startsWith('.env.dev-')),
        ).toEqual([]);
      }
    },
  );

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

  it('rejects an explicit remote database URL before dispatching local preflight', () => {
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
  trap - EXIT
  trap ':' HUP INT TERM
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
        // Bun can preserve the cleanup command's exit or the package signal.
        expect([
          { code: 29, signal: null },
          { code: null, signal },
        ]).toContainEqual({ code: result.code, signal: result.signal });
      } else {
        expect(result.code, result.stderr).toBe(29);
        expect(result.signal).toBeNull();
      }
      const next = leaseAttempt();
      expect(next.status, next.stderr).toBe(0);
    },
  );
});
