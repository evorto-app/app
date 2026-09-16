import { afterEach, describe, expect, it, vi } from '@effect/vitest';

import {
  ensurePostgresIntegrationDatabase,
  postgresMaintenanceDatabaseUrl,
} from './postgres-integration-database';

describe('local PostgreSQL integration database', () => {
  it('keeps an existing integration database unchanged', async () => {
    const create = vi.fn(async () => undefined);

    await ensurePostgresIntegrationDatabase({
      create,
      exists: async () => true,
    });

    expect(create).not.toHaveBeenCalled();
  });

  it('creates a missing integration database exactly once', async () => {
    const create = vi.fn(async () => undefined);

    await ensurePostgresIntegrationDatabase({
      create,
      exists: async () => false,
    });

    expect(create).toHaveBeenCalledOnce();
  });

  it('surfaces inspection and creation failures unchanged', async () => {
    const inspectionFailure = new Error('database inspection failed');
    const creationFailure = new Error('database creation failed');

    await expect(
      ensurePostgresIntegrationDatabase({
        create: async () => undefined,
        exists: async () => Promise.reject(inspectionFailure),
      }),
    ).rejects.toBe(inspectionFailure);
    await expect(
      ensurePostgresIntegrationDatabase({
        create: async () => Promise.reject(creationFailure),
        exists: async () => false,
      }),
    ).rejects.toBe(creationFailure);
  });

  it('uses the maintenance database without changing connection settings', () => {
    expect(
      postgresMaintenanceDatabaseUrl(
        'postgresql://evorto:secret@db:5432/appdb?sslmode=disable',
      ),
    ).toBe('postgresql://evorto:secret@db:5432/postgres?sslmode=disable');
  });
});

describe('standalone PostgreSQL integration bootstrap', () => {
  afterEach(() => {
    vi.doUnmock('pg');
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const prepareRunner = async ({ exists = false, version = '170010' } = {}) => {
    vi.resetModules();
    vi.stubEnv('POSTGRES_INTEGRATION_DISPOSABLE', 'true');
    vi.stubEnv(
      'POSTGRES_INTEGRATION_DATABASE_URL',
      'postgresql://fixture:fixture@localhost:55432/evorto_postgres_integration',
    );
    const connections: string[] = [];
    const schemaResets: string[] = [];
    const creates = vi.fn();
    const spawn = vi.fn(() => ({ exited: Promise.resolve(0) }));
    vi.stubGlobal('Bun', { spawn });
    vi.doMock('pg', async (importOriginal) => ({
      ...(await importOriginal<typeof import('pg')>()),
      Pool: class {
        readonly database: string;
        constructor({ connectionString }: { connectionString: string }) {
          this.database = new URL(connectionString).pathname.slice(1);
          connections.push(this.database);
        }
        async query(sql: string) {
          if (this.database === 'evorto_postgres_integration' && !exists) {
            throw new Error('integration database does not exist');
          }
          if (sql === 'SHOW server_version_num') {
            return { rows: [{ server_version_num: version }] };
          }
          if (sql.startsWith('SELECT EXISTS')) return { rows: [{ exists }] };
          if (sql === 'CREATE DATABASE "evorto_postgres_integration"') {
            creates();
            exists = true;
          }
          return { rows: [] };
        }
        async connect() {
          if (!exists) throw new Error('integration database does not exist');
          return {
            query: async (sql: string) => {
              if (sql === 'DROP SCHEMA IF EXISTS public CASCADE') {
                schemaResets.push(this.database);
              }
            },
            release: () => undefined,
          };
        }
        async end() {}
      },
    }));
    return { connections, creates, schemaResets, spawn };
  };

  it.each([false, true])(
    'bootstraps the standalone runner with database existence %s',
    async (exists) => {
      const probe = await prepareRunner({ exists });
      await import('./run-postgres-integration');
      expect(probe.creates).toHaveBeenCalledTimes(exists ? 0 : 1);
      expect(probe.connections[0]).toBe('postgres');
      expect(probe.connections).not.toContain('appdb');
      expect(probe.schemaResets).toEqual(['evorto_postgres_integration']);
      expect(probe.spawn).toHaveBeenCalledTimes(2);
      for (const call of probe.spawn.mock.calls) {
        expect(call).toEqual([
          expect.any(Array),
          expect.objectContaining({
            env: expect.objectContaining({
              POSTGRES_DB: 'evorto_postgres_integration',
              DATABASE_URL:
                'postgresql://fixture:fixture@localhost:55432/evorto_postgres_integration',
              LOCAL_DATABASE: 'true',
            }),
          }),
        ]);
      }
    },
  );

  it('rejects an unsupported server version before creation, reset, or child commands', async () => {
    const probe = await prepareRunner({ version: '160010' });
    await expect(import('./run-postgres-integration')).rejects.toThrow(
      'PostgreSQL 17 is required',
    );
    expect(probe.creates).not.toHaveBeenCalled();
    expect(probe.schemaResets).toEqual([]);
    expect(probe.spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['POSTGRES_INTEGRATION_DISPOSABLE', 'false'],
    [
      'POSTGRES_INTEGRATION_DATABASE_URL',
      'postgresql://fixture:fixture@remote.invalid:55432/evorto_postgres_integration',
    ],
    [
      'POSTGRES_INTEGRATION_DATABASE_URL',
      'postgresql://fixture:fixture@localhost:55432/appdb',
    ],
    [
      'POSTGRES_INTEGRATION_DATABASE_URL',
      'postgresql://fixture:fixture@localhost:55432//evorto_postgres_integration',
    ],
    [
      'POSTGRES_INTEGRATION_DATABASE_URL',
      'postgresql://fixture:fixture@localhost:55432/evorto_postgres_integration?host=remote.invalid',
    ],
  ])('rejects unsafe %s before any database access', async (name, value) => {
    const probe = await prepareRunner();
    vi.stubEnv(name, value);
    await expect(import('./run-postgres-integration')).rejects.toThrow();
    expect(probe.connections).toEqual([]);
    expect(probe.creates).not.toHaveBeenCalled();
    expect(probe.schemaResets).toEqual([]);
    expect(probe.spawn).not.toHaveBeenCalled();
  });
});
