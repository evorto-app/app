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

const runSeedHelper = ({
  accountId,
  preflightOnly = true,
}: {
  accountId?: string;
  preflightOnly?: boolean;
}) => {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'evorto-database-preflight-'),
  );
  temporaryDirectories.push(directory);
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
Bun.connect = denyConnection;
syncBuiltinESMExports();
fs.writeFileSync(${JSON.stringify(readyPath)}, 'ready');
`,
  );

  const result = spawnSync(
    'bun',
    [
      '--tsconfig-override',
      path.join(repositoryRoot, 'tsconfig.json'),
      '--preload',
      preloadPath,
      path.join(repositoryRoot, 'helpers/database.ts'),
    ],
    {
      cwd: directory,
      encoding: 'utf8',
      env: {
        APP_ENVIRONMENT: 'staging',
        DATABASE_TLS_REQUIRED: 'false',
        DATABASE_URL:
          'postgresql://fixture:fixture@127.0.0.1:1/seed_fixture?sslmode=disable',
        NODE_ENV: 'production',
        PATH: process.env['PATH'],
        ...(preflightOnly && { STAGING_SEED_PREFLIGHT_ONLY: 'true' }),
        ...(accountId !== undefined && { STRIPE_TEST_ACCOUNT_ID: accountId }),
      },
      timeout: 5000,
    },
  );

  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  expect(fs.existsSync(readyPath)).toBe(true);
  return {
    attemptedConnection: fs.existsSync(markerPath),
    output: `${result.stdout}\n${result.stderr}`,
    status: result.status,
  };
};

describe('database seed preflight', () => {
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
