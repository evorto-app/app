import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const repositoryRoot = process.cwd();
const temporaryDirectories: string[] = [];
const connectionMarker = 'DATABASE_PREFLIGHT_CONNECTION_ATTEMPT';

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { force: true, recursive: true });
  }
});

const runDatabaseHelper = ({
  entrypoint,
  environment,
  dotenvFiles = {},
  captureSetupInputs = false,
  playwright = false,
}: {
  entrypoint: string;
  dotenvFiles?: Readonly<
    Partial<Record<'.env' | '.env.dev' | '.env.dev.local', string>>
  >;
  captureSetupInputs?: boolean;
  playwright?: boolean;
  environment: Readonly<Record<string, string>>;
}) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-database-preflight-'),
  );
  temporaryDirectories.push(directory);
  fs.writeFileSync(path.join(directory, 'bunfig.toml'), 'env = false\n');
  for (const [name, contents] of Object.entries(dotenvFiles)) {
    fs.writeFileSync(path.join(directory, name), contents);
  }
  const seedInputsPath = path.join(directory, 'seed-inputs.json');
  const clientCreatedPath = path.join(directory, 'client-created');
  const markerPath = path.join(directory, 'connection-attempt');
  const readyPath = path.join(directory, 'guard-ready');
  const preloadPath = path.join(directory, 'deny-network.mjs');
  fs.writeFileSync(
    preloadPath,
    `import fs from 'node:fs';
import net from 'node:net';
import tls from 'node:tls';
import { syncBuiltinESMExports } from 'node:module';

const denyConnection = () => {
  fs.writeFileSync(${JSON.stringify(markerPath)}, 'blocked');
  process.stderr.write(${JSON.stringify(connectionMarker)} + '\\n');
  // pg can wait for a deliberately blocked connection during pool cleanup.
  // End only this isolated child after throwing, without allowing any socket.
  setTimeout(() => process.exit(86), 0);
  throw new Error(${JSON.stringify(connectionMarker)});
};
net.Socket.prototype.connect = denyConnection;
net.connect = denyConnection;
net.createConnection = denyConnection;
tls.connect = denyConnection;
globalThis.fetch = denyConnection;
if (typeof Bun !== 'undefined') Bun.connect = denyConnection;
syncBuiltinESMExports();
fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready');
${
  captureSetupInputs
    ? `
const { mock } = await import('bun:test');
const { getDailySeed } = await import(${JSON.stringify(path.join(repositoryRoot, 'helpers/seed-falso.ts'))});
const { resolveDatabaseSeedInputs } = await import(${JSON.stringify(path.join(repositoryRoot, 'src/db/setup-database.ts'))});
mock.module(${JSON.stringify(path.join(repositoryRoot, 'src/db/database-client.ts'))}, () => ({
  createDatabaseClient: () => {
    fs.writeFileSync(${JSON.stringify(clientCreatedPath)}, 'created');
    return { database: {}, pool: { end: async () => {} } };
  },
}));
mock.module(${JSON.stringify(path.join(repositoryRoot, 'src/db/setup-database.ts'))}, () => ({
  resolveDatabaseSeedInputs,
  setupDatabase: async (_database, options) => {
    fs.writeFileSync(${JSON.stringify(seedInputsPath)}, JSON.stringify({
      seedDate: options.seedDate.toISOString(),
      seedKey: getDailySeed(options.seedDate),
    }));
  },
}));
`
    : ''
}
`,
  );

  if (playwright) {
    fs.writeFileSync(
      path.join(directory, 'fixture.test.ts'),
      `import { test } from ${JSON.stringify(path.join(repositoryRoot, entrypoint))};
       test('uses the actual database fixture', async ({ database }) => {
         await database.execute('select 1');
       });`,
    );
    fs.writeFileSync(
      path.join(directory, 'playwright.config.mjs'),
      `export default ${JSON.stringify({
        testDir: directory,
        tsconfig: path.join(repositoryRoot, 'tsconfig.json'),
        outputDir: path.join(directory, 'results'),
        reporter: 'line',
        workers: 1,
      })};`,
    );
  }

  const result = spawnSync(
    playwright ? 'node' : 'bun',
    playwright
      ? [
          path.join(repositoryRoot, 'node_modules/@playwright/test/cli.js'),
          'test',
          '--config',
          path.join(directory, 'playwright.config.mjs'),
        ]
      : [
          '--tsconfig-override',
          path.join(repositoryRoot, 'tsconfig.json'),
          '--preload',
          preloadPath,
          path.join(repositoryRoot, entrypoint),
        ],
    {
      cwd: directory,
      encoding: 'utf8',
      env: {
        PATH: process.env['PATH'],
        ...(playwright && { NODE_OPTIONS: `--import=${preloadPath}` }),
        ...environment,
      },
      timeout: playwright ? 15_000 : 5000,
    },
  );

  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(fs.existsSync(readyPath)).toBe(true);
  return {
    attemptedConnection: fs.existsSync(markerPath),
    clientCreated: fs.existsSync(clientCreatedPath),
    seedInputs: fs.existsSync(seedInputsPath)
      ? fs.readFileSync(seedInputsPath, 'utf8')
      : undefined,
    output: `${result.stdout}\n${result.stderr}`,
    status: result.status,
  };
};

const runSeedHelper = ({
  accountId,
  preflightOnly = true,
  nowIso,
  seedKey,
  dotenvFiles,
  captureSetupInputs,
}: {
  accountId?: string;
  nowIso?: string;
  seedKey?: string;
  dotenvFiles?: Readonly<
    Partial<Record<'.env' | '.env.dev' | '.env.dev.local', string>>
  >;
  captureSetupInputs?: boolean;
  preflightOnly?: boolean;
}) =>
  runDatabaseHelper({
    entrypoint: 'helpers/database.ts',
    ...(dotenvFiles !== undefined && { dotenvFiles }),
    ...(captureSetupInputs !== undefined && { captureSetupInputs }),
    environment: {
      APP_ENVIRONMENT: 'staging',
      DATABASE_TLS_REQUIRED: 'false',
      DATABASE_URL:
        'postgresql://fixture:fixture@127.0.0.1:1/seed_fixture?sslmode=disable',
      NODE_ENV: 'production',
      ...(nowIso !== undefined && { E2E_NOW_ISO: nowIso }),
      ...(seedKey !== undefined && { E2E_SEED_KEY: seedKey }),
      ...(preflightOnly && { STAGING_SEED_PREFLIGHT_ONLY: 'true' }),
      ...(accountId !== undefined && { STRIPE_TEST_ACCOUNT_ID: accountId }),
    },
  });

describe('managed database TLS preflight', () => {
  const entrypoints = [
    'ops/drizzle.config.mjs',
    'src/server/ops/database-prerequisites.ts',
    'src/server/ops/reset-staging-database.ts',
  ];
  const environment = {
    APP_ENVIRONMENT: 'staging',
    DATABASE_RUNTIME_ROLE: 'evorto_runtime',
    DATABASE_TLS_REQUIRED: 'true',
    DATABASE_URL: 'postgresql://fixture:fixture@127.0.0.1:1/tls_fixture',
    STAGING_RESET_CONFIRMATION: 'reset-and-seed-staging',
  };

  it.each(entrypoints)(
    'rejects a whitespace-only CA before %s can connect',
    (entrypoint) => {
      const result = runDatabaseHelper({
        entrypoint,
        environment: {
          ...environment,
          DATABASE_TLS_CA_CERTIFICATE: ' \t\r\n ',
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.output).toContain(
        'DATABASE_TLS_CA_CERTIFICATE is required',
      );
      expect(result.attemptedConnection).toBe(false);
    },
  );

  it.each(entrypoints)(
    'rejects a defined blank CA with optional TLS before %s can connect',
    (entrypoint) => {
      for (const certificate of ['', ' \t\r\n ']) {
        const result = runDatabaseHelper({
          entrypoint,
          environment: {
            ...environment,
            DATABASE_TLS_REQUIRED: 'false',
            DATABASE_TLS_CA_CERTIFICATE: certificate,
          },
        });
        expect(result.status).not.toBe(0);
        expect(result.output).toContain(
          'DATABASE_TLS_CA_CERTIFICATE must not be blank',
        );
        expect(result.attemptedConnection).toBe(false);
      }
    },
  );

  it.each(entrypoints)(
    'accepts a nonblank CA before the connection guard for %s',
    (entrypoint) => {
      const result = runDatabaseHelper({
        entrypoint,
        environment: {
          ...environment,
          DATABASE_TLS_CA_CERTIFICATE:
            '\n-----BEGIN CERTIFICATE-----\nfixture\n-----END CERTIFICATE-----\n',
        },
      });
      const opensConnection = entrypoint !== 'ops/drizzle.config.mjs';

      expect(result.status, result.output).toBe(opensConnection ? 86 : 0);
      expect(result.attemptedConnection).toBe(opensConnection);
      if (opensConnection) {
        expect(result.output).toContain(connectionMarker);
      }
    },
  );
});

describe('local database reset preflight', () => {
  it('rejects the reserved integration name before application reset connects', () => {
    const result = runDatabaseHelper({
      entrypoint: 'helpers/reset-database-schema.ts',
      environment: {
        LOCAL_DATABASE: 'true',
        LOCAL_DATABASE_CONFIRM_RESET: 'evorto-local-reset',
        POSTGRES_DB: 'evorto_postgres_integration',
        DATABASE_URL:
          'postgresql://fixture:fixture@127.0.0.1:1/evorto_postgres_integration?sslmode=disable',
      },
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('reserved integration database');
    expect(result.attemptedConnection).toBe(false);
  });

  const environment = {
    DATABASE_URL:
      'postgresql://fixture:fixture@127.0.0.1:1/unrelated_database?sslmode=disable',
    LOCAL_DATABASE: 'true',
    LOCAL_DATABASE_CONFIRM_RESET: 'evorto-local-reset',
  };

  it.each([
    {
      databaseName: undefined,
      pathname: '/unrelated_database',
      message: 'POSTGRES_DB is required',
    },
    {
      databaseName: '',
      pathname: '/unrelated_database',
      message: 'POSTGRES_DB is required',
    },
    {
      databaseName: 'appdb',
      pathname: '/unrelated_database',
      message: 'configured local database (appdb)',
    },
    {
      databaseName: 'appdb',
      pathname: '//appdb',
      message: 'configured local database (appdb)',
    },
    {
      databaseName: 'reports#1',
      pathname: '/reports%231',
      message: 'configured local database (reports#1)',
    },
  ])(
    'rejects $databaseName before connecting or mutating',
    ({ databaseName, message, pathname }) => {
      const result = runDatabaseHelper({
        entrypoint: 'helpers/reset-database-schema.ts',
        environment: {
          ...environment,
          DATABASE_URL: `postgresql://fixture:fixture@127.0.0.1:1${pathname}?sslmode=disable`,
          ...(databaseName !== undefined && { POSTGRES_DB: databaseName }),
        },
      });

      expect(result.status).not.toBe(0);
      expect(result.output).toContain(message);
      expect(result.attemptedConnection).toBe(false);
    },
  );

  it('accepts an exact literal name before the test guard blocks its connection', () => {
    const databaseName = ' fixture % ü ';
    const result = runDatabaseHelper({
      entrypoint: 'helpers/reset-database-schema.ts',
      environment: {
        ...environment,
        DATABASE_URL: `postgresql://fixture:fixture@127.0.0.1:1/${encodeURIComponent(databaseName)}?sslmode=disable`,
        POSTGRES_DB: databaseName,
      },
    });

    expect(result.status, result.output).toBe(86);
    expect(result.output).toContain(connectionMarker);
    expect(result.attemptedConnection).toBe(true);
  });
});

describe('database seed preflight', () => {
  it.each([
    ['.env', true],
    ['.env.dev', true],
    ['.env.dev.local', true],
    ['.env.dev.local', false],
  ] as const)(
    'rejects an invalid date from %s before connecting (preflight %s)',
    (file, preflightOnly) => {
      const result = runSeedHelper({
        accountId: 'acct_seed_fixture',
        dotenvFiles: { [file]: 'E2E_NOW_ISO=not-an-iso-date\n' },
        captureSetupInputs: true,
        preflightOnly,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('Invalid E2E_NOW_ISO');
      expect(result.clientCreated).toBe(false);
      expect(result.attemptedConnection).toBe(false);
    },
  );

  it.each([
    {
      label: 'base file',
      dotenvFiles: {
        '.env': 'E2E_NOW_ISO=2028-02-03T14:15:00Z\nE2E_SEED_KEY=base-key\n',
      },
      expectedDate: '2028-02-03T00:00:00.000Z',
      expectedKey: 'base-key',
    },
    {
      label: 'generated over base file',
      dotenvFiles: {
        '.env': 'E2E_NOW_ISO=not-an-iso-date\nE2E_SEED_KEY=base-key\n',
        '.env.dev':
          'E2E_NOW_ISO=2028-03-04T14:15:00Z\nE2E_SEED_KEY=generated-key\n',
      },
      expectedDate: '2028-03-04T00:00:00.000Z',
      expectedKey: 'generated-key',
    },
    {
      label: 'shared over generated and base files',
      dotenvFiles: {
        '.env': 'E2E_NOW_ISO=not-an-iso-date\nE2E_SEED_KEY=base-key\n',
        '.env.dev': 'E2E_NOW_ISO=not-an-iso-date\nE2E_SEED_KEY=generated-key\n',
        '.env.dev.local':
          'E2E_NOW_ISO=2028-04-05T14:15:00Z\nE2E_SEED_KEY=shared-key\n',
      },
      expectedDate: '2028-04-05T00:00:00.000Z',
      expectedKey: 'shared-key',
    },
  ])(
    'resolves the actual seed date and RNG key from $label',
    ({ dotenvFiles, expectedDate, expectedKey }) => {
      const result = runSeedHelper({
        accountId: 'acct_seed_fixture',
        dotenvFiles,
        captureSetupInputs: true,
        preflightOnly: false,
      });
      expect(result.status, result.output).toBe(0);
      expect(result.attemptedConnection).toBe(false);
      expect(result.seedInputs).toBe(
        JSON.stringify({ seedDate: expectedDate, seedKey: expectedKey }),
      );
    },
  );

  it('preserves explicit process seed settings over file configuration', () => {
    const result = runSeedHelper({
      accountId: 'acct_seed_fixture',
      nowIso: '2028-05-06T14:15:00Z',
      seedKey: 'process-key',
      dotenvFiles: {
        '.env.dev.local':
          'E2E_NOW_ISO=not-an-iso-date\nE2E_SEED_KEY=shared-key\n',
      },
      captureSetupInputs: true,
      preflightOnly: false,
    });
    expect(result.status, result.output).toBe(0);
    expect(result.attemptedConnection).toBe(false);
    expect(result.seedInputs).toBe(
      JSON.stringify({
        seedDate: '2028-05-06T00:00:00.000Z',
        seedKey: 'process-key',
      }),
    );
  });

  it.each(['', '   '])(
    'keeps an explicit blank caller clock override %j',
    (nowIso) => {
      const result = runSeedHelper({
        accountId: 'acct_seed_fixture',
        nowIso,
        dotenvFiles: { '.env.dev.local': 'E2E_NOW_ISO=not-an-iso-date\n' },
      });
      expect(result.status, result.output).toBe(0);
      expect(result.attemptedConnection).toBe(false);
    },
  );

  it.each(['', '   '])(
    'keeps an explicit blank caller RNG override %j',
    (seedKey) => {
      const result = runSeedHelper({
        accountId: 'acct_seed_fixture',
        nowIso: '2028-05-06T14:15:00Z',
        seedKey,
        dotenvFiles: { '.env.dev.local': 'E2E_SEED_KEY=shared-key\n' },
        captureSetupInputs: true,
        preflightOnly: false,
      });
      expect(result.status, result.output).toBe(0);
      expect(result.attemptedConnection).toBe(false);
      expect(result.seedInputs).toBe(
        JSON.stringify({
          seedDate: '2028-05-06T00:00:00.000Z',
          seedKey: '2028-05-06',
        }),
      );
    },
  );

  it('does not hide an invalid process date behind a valid file date', () => {
    const result = runSeedHelper({
      accountId: 'acct_seed_fixture',
      nowIso: 'not-an-iso-date',
      dotenvFiles: { '.env.dev.local': 'E2E_NOW_ISO=2028-05-06T14:15:00Z\n' },
    });
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Invalid E2E_NOW_ISO');
    expect(result.attemptedConnection).toBe(false);
  });

  it.each([true, false])(
    'rejects invalid seed time before connecting (preflight %s)',
    (preflightOnly) => {
      const result = runSeedHelper({
        accountId: 'acct_seed_fixture',
        nowIso: 'not-an-iso-date',
        preflightOnly,
      });
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('Invalid E2E_NOW_ISO');
      expect(result.attemptedConnection).toBe(false);
    },
  );

  it('accepts a valid pinned seed date without connecting', () => {
    const result = runSeedHelper({
      accountId: 'acct_seed_fixture',
      nowIso: '2026-09-16T12:00:00.000Z',
    });
    expect(result.status, result.output).toBe(0);
    expect(result.attemptedConnection).toBe(false);
  });

  it.each([
    { accountId: undefined, label: 'missing' },
    { accountId: '   ', label: 'blank' },
  ])('rejects a $label Stripe account before connecting', ({ accountId }) => {
    const result = runSeedHelper({
      ...(accountId !== undefined && { accountId }),
    });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('STRIPE_TEST_ACCOUNT_ID');
    expect(result.attemptedConnection).toBe(false);
  });

  it('rejects missing Stripe configuration before ordinary seeding connects', () => {
    const result = runSeedHelper({ preflightOnly: false });

    expect(result.status).not.toBe(0);
    expect(result.output).toContain('STRIPE_TEST_ACCOUNT_ID');
    expect(result.attemptedConnection).toBe(false);
  });

  it('validates configured preflight without opening the database', () => {
    const result = runSeedHelper({ accountId: ' acct_seed_fixture ' });

    expect(result.status, result.output).toBe(0);
    expect(result.attemptedConnection).toBe(false);
  });

  it('blocks the ordinary seed connection in the test guard', () => {
    const result = runSeedHelper({
      accountId: 'acct_seed_fixture',
      preflightOnly: false,
    });

    expect(result.status, result.output).toBe(86);
    expect(result.output).toContain(connectionMarker);
    expect(result.attemptedConnection).toBe(true);
  });
});

describe(
  'direct Playwright database fixture preflight',
  { timeout: 20_000 },
  () => {
    const runFixture = (
      databaseUrl: string,
      postgresPort = '55432',
      pgPort?: string,
    ) =>
      runDatabaseHelper({
        entrypoint: 'tests/support/fixtures/base-test.ts',
        playwright: true,
        environment: {
          AUTH0_MANAGEMENT_CLIENT_ID: 'fixture-management',
          AUTH0_MANAGEMENT_CLIENT_SECRET: 'fixture-management-secret',
          BASE_URL: 'http://localhost:4200',
          CLIENT_ID: 'fixture',
          CLIENT_SECRET: 'fixture',
          DATABASE_URL: databaseUrl,
          E2E_SELECTED_PROJECTS: 'local-chrome-baseline',
          ISSUER_BASE_URL: 'https://fixture.invalid',
          LOCAL_DATABASE: 'true',
          POSTGRES_DB: 'appdb',
          POSTGRES_HOST_PORT: postgresPort,
          ...(pgPort === undefined ? {} : { PGPORT: pgPort }),
          SECRET: 'fixture',
          STRIPE_API_KEY: 'fixture',
          STRIPE_TEST_ACCOUNT_ID: 'acct_fixture',
        },
      });

    it.each([
      [
        'postgresql://fixture:fixture@remote.invalid:55432/appdb',
        'non-local database host',
      ],
      [
        'postgresql://fixture:fixture@localhost:55433/appdb',
        'configured POSTGRES_HOST_PORT',
      ],
    ])(
      'rejects an unsafe target before fixture SQL: %s',
      (databaseUrl, message) => {
        const result = runFixture(databaseUrl);
        expect(result.status).not.toBe(0);
        expect(result.output).toContain(message);
        expect(result.attemptedConnection).toBe(false);
      },
    );

    it('rejects a mismatched inherited PGPORT before fixture SQL', () => {
      const result = runFixture(
        'postgresql://fixture:fixture@localhost/appdb',
        '5432',
        '55433',
      );
      expect(result.status).not.toBe(0);
      expect(result.output).toContain('configured POSTGRES_HOST_PORT');
      expect(result.attemptedConnection).toBe(false);
    });

    it('allows the matching target as far as the isolated connection barrier', () => {
      const result = runFixture(
        'postgresql://fixture:fixture@localhost:55432/appdb',
      );
      expect(result.status).not.toBe(0);
      expect(result.output).toContain(connectionMarker);
      expect(result.attemptedConnection).toBe(true);
    });
  },
);
