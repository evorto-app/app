import { ConfigProvider, Effect, Option } from 'effect';
import { spawnSync } from 'node:child_process';
import { inspect } from 'node:util';
import { Client } from 'pg';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { databaseConfig } from '../../src/db/database-config';
import { createPgClientConfig } from '../../src/db/pg-connection-config';

import {
  postgresIntegrationChildEnvironment,
  resolvePostgresIntegrationEnvironment,
} from './postgres-integration-environment';

const localEnvironment = {
  POSTGRES_INTEGRATION_DATABASE_URL:
    'postgresql://evorto:secret@localhost:5432/evorto_postgres_integration',
  POSTGRES_INTEGRATION_DISPOSABLE: 'true',
};

describe('PostgreSQL integration environment', () => {
  afterEach(() => vi.unstubAllEnvs());
  it('accepts only the named disposable loopback database', async () => {
    await expect(
      resolvePostgresIntegrationEnvironment({
        environment: localEnvironment,
      }),
    ).resolves.toEqual({
      databaseName: 'evorto_postgres_integration',
      databaseUrl:
        'postgresql://evorto:secret@localhost:5432/evorto_postgres_integration?sslmode=disable',
    });
  });

  it('accepts ordinary percent escapes with the same database name as pg', async () => {
    const databaseUrl =
      'postgresql://evorto:secret@localhost:5432/%65vorto%5Fpostgres_integration';
    // Constructing a client parses the target without opening a connection.
    const client = new Client({ connectionString: databaseUrl });
    const resolved = await resolvePostgresIntegrationEnvironment({
      environment: {
        ...localEnvironment,
        POSTGRES_INTEGRATION_DATABASE_URL: databaseUrl,
      },
    });

    expect(client.database).toBe('evorto_postgres_integration');
    expect(resolved.databaseName).toBe(client.database);
    expect(resolved.databaseUrl).toBe(`${databaseUrl}?sslmode=disable`);
  });

  it.each([
    {
      driverName: '/evorto_postgres_integration',
      pathname: '//evorto_postgres_integration',
    },
    {
      driverName: '//evorto_postgres_integration',
      pathname: '///evorto_postgres_integration',
    },
    {
      driverName: 'evorto_postgres_integration%2Fother',
      pathname: '/evorto_postgres_integration%2Fother',
    },
    {
      driverName: 'evorto_postgres_integration%23other',
      pathname: '/evorto_postgres_integration%23other',
    },
    {
      driverName: 'evorto_postgres_integration%3Fother',
      pathname: '/evorto_postgres_integration%3Fother',
    },
  ])(
    'rejects a different pg target before returning an environment: $pathname',
    async ({ driverName, pathname }) => {
      const databaseUrl = `postgresql://evorto:secret@localhost:5432${pathname}`;
      expect(new Client({ connectionString: databaseUrl }).database).toBe(
        driverName,
      );
      await expect(
        resolvePostgresIntegrationEnvironment({
          environment: {
            ...localEnvironment,
            POSTGRES_INTEGRATION_DATABASE_URL: databaseUrl,
          },
        }),
      ).rejects.toThrow(
        'Local PostgreSQL integration tests require database evorto_postgres_integration',
      );
    },
  );

  it('accepts the named disposable database through IPv6 loopback', async () => {
    await expect(
      resolvePostgresIntegrationEnvironment({
        environment: {
          ...localEnvironment,
          POSTGRES_INTEGRATION_DATABASE_URL:
            'postgresql://evorto:secret@[::1]:5432/evorto_postgres_integration',
        },
      }),
    ).resolves.toEqual({
      databaseName: 'evorto_postgres_integration',
      databaseUrl:
        'postgresql://evorto:secret@[::1]:5432/evorto_postgres_integration?sslmode=disable',
    });
  });

  it('keeps every child command on the validated disposable database', async () => {
    const integrationEnvironment = await resolvePostgresIntegrationEnvironment({
      environment: localEnvironment,
    });

    expect(
      postgresIntegrationChildEnvironment(integrationEnvironment, {}),
    ).toEqual({
      DATABASE_TLS_REQUIRED: 'false',
      DATABASE_URL:
        'postgresql://evorto:secret@localhost:5432/evorto_postgres_integration?sslmode=disable',
      POSTGRES_DB: 'evorto_postgres_integration',
    });
  });

  it.each(['', ':0', ':65536', ':invalid'])(
    'rejects an absent or invalid explicit port %s despite PGPORT',
    async (port) => {
      vi.stubEnv('PGPORT', '55439');
      await expect(
        resolvePostgresIntegrationEnvironment({
          environment: {
            ...localEnvironment,
            PGPORT: '55439',
            POSTGRES_INTEGRATION_DATABASE_URL: `postgresql://evorto:secret@localhost${port}/evorto_postgres_integration`,
          },
        }),
      ).rejects.toThrow(/explicit port|valid PostgreSQL URL/u);
    },
  );

  it.each([
    'require',
    'verify-full',
    'disable&sslmode=require',
    'require&sslmode=disable',
  ])('rejects every TLS mode other than disable: %s', async (mode) => {
    await expect(
      resolvePostgresIntegrationEnvironment({
        environment: {
          ...localEnvironment,
          POSTGRES_INTEGRATION_DATABASE_URL: `${localEnvironment.POSTGRES_INTEGRATION_DATABASE_URL}?sslmode=${mode}`,
        },
      }),
    ).rejects.toThrow('must omit sslmode or use sslmode=disable');
  });

  it.each(['disable', 'disable&sslmode=disable'])(
    'normalizes explicit local TLS settings %s',
    async (mode) => {
      const resolved = await resolvePostgresIntegrationEnvironment({
        environment: {
          ...localEnvironment,
          POSTGRES_INTEGRATION_DATABASE_URL: `${localEnvironment.POSTGRES_INTEGRATION_DATABASE_URL}?sslmode=${mode}`,
        },
      });
      expect(resolved.databaseUrl).toBe(
        `${localEnvironment.POSTGRES_INTEGRATION_DATABASE_URL}?sslmode=disable`,
      );
    },
  );

  it('isolates actual child pg and Effect configuration from inherited TLS material', async () => {
    const integrationEnvironment = await resolvePostgresIntegrationEnvironment({
      environment: localEnvironment,
    });
    const parentEnvironment = {
      ...process.env,
      DATABASE_TLS_CA_CERTIFICATE: 'synthetic-staging-ca',
      DATABASE_TLS_REQUIRED: 'true',
      DATABASE_TLS_SERVER_NAME: 'staging.invalid',
      DATABASE_URL: 'postgresql://other:other@staging.invalid:5432/appdb',
      KEEP_CREDENTIAL: 'synthetic-required-credential',
      OMIT_UNDEFINED: undefined,
      PGPORT: '55439',
      PGREQUIRESSL: '1',
      PGSSLCERT: '/synthetic/client.crt',
      PGSSLKEY: '/synthetic/client.key',
      PGSSLMODE: 'verify-full',
      PGSSLNEGOTIATION: 'direct',
      PGSSLROOTCERT: '/synthetic/root.crt',
    };
    const childEnvironment = postgresIntegrationChildEnvironment(
      integrationEnvironment,
      parentEnvironment,
    );
    expect(childEnvironment['KEEP_CREDENTIAL']).toBe(
      'synthetic-required-credential',
    );
    expect(childEnvironment).not.toHaveProperty('OMIT_UNDEFINED');
    expect(childEnvironment).not.toHaveProperty('DATABASE_TLS_CA_CERTIFICATE');
    expect(childEnvironment).not.toHaveProperty('DATABASE_TLS_SERVER_NAME');
    expect(
      Object.keys(childEnvironment).some((name) => name.startsWith('PGSSL')),
    ).toBe(false);
    expect(childEnvironment).not.toHaveProperty('PGREQUIRESSL');
    expect(parentEnvironment.PGSSLNEGOTIATION).toBe('direct');
    expect(parentEnvironment.DATABASE_TLS_REQUIRED).toBe('true');

    const config = await Effect.runPromise(
      databaseConfig.parse(ConfigProvider.fromEnv({ env: childEnvironment })),
    );
    expect(config.DATABASE_TLS_REQUIRED).toBe(false);
    expect(Option.isNone(config.DATABASE_TLS_CA_CERTIFICATE)).toBe(true);
    expect(Option.isNone(config.DATABASE_TLS_SERVER_NAME)).toBe(true);
    expect(
      createPgClientConfig({ databaseUrl: config.DATABASE_URL }).ssl,
    ).toBeUndefined();

    // The real driver parses its own process environment without opening a socket.
    const child = spawnSync(
      process.execPath,
      [
        '-e',
        `
      const { Client } = require('pg');
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      process.stdout.write(JSON.stringify({
        database: client.database, host: client.host, port: client.port,
        ssl: client.ssl, user: client.user,
      }));
    `,
      ],
      { encoding: 'utf8', env: childEnvironment, timeout: 5000 },
    );
    expect(child.status, child.stderr).toBe(0);
    expect(child.stdout).toBe(
      JSON.stringify({
        database: 'evorto_postgres_integration',
        host: 'localhost',
        port: 5432,
        ssl: false,
        user: 'evorto',
      }),
    );
  });

  it('does not retain malformed database URL credentials in parse errors', async () => {
    const sentinelUsername = 'sentinel-integration-username';
    const sentinelPassword = 'sentinel-integration-password';
    let thrown: unknown;

    try {
      await resolvePostgresIntegrationEnvironment({
        environment: {
          ...localEnvironment,
          POSTGRES_INTEGRATION_DATABASE_URL: `postgresql://${sentinelUsername}:${sentinelPassword}@localhost:99999/appdb`,
        },
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    if (!(thrown instanceof Error)) {
      throw new Error('Expected malformed PostgreSQL URL parsing to fail');
    }
    expect(thrown.message).toBe(
      'POSTGRES_INTEGRATION_DATABASE_URL must be a valid PostgreSQL URL',
    );

    const representations = [
      thrown.message,
      thrown.stack ?? '',
      String(thrown),
      inspect(thrown),
      inspect(thrown, { depth: null, showHidden: true }),
    ];
    for (const credential of [sentinelUsername, sentinelPassword]) {
      for (const representation of representations) {
        expect(representation).not.toContain(credential);
      }
    }
    expect(thrown).not.toHaveProperty('cause');
  });

  it.each([
    {
      environment: {
        ...localEnvironment,
        POSTGRES_INTEGRATION_DISPOSABLE: 'false',
      },
      message: 'POSTGRES_INTEGRATION_DISPOSABLE=true',
    },
    {
      environment: {
        ...localEnvironment,
        POSTGRES_INTEGRATION_DATABASE_URL:
          'postgresql://evorto:secret@localhost:5432/appdb',
      },
      message: 'evorto_postgres_integration',
    },
    {
      environment: {
        ...localEnvironment,
        POSTGRES_INTEGRATION_DATABASE_URL:
          'postgresql://evorto:secret@production.example.com:5432/evorto_postgres_integration',
      },
      message: 'only a loopback database',
    },
    {
      environment: {
        ...localEnvironment,
        POSTGRES_INTEGRATION_DATABASE_URL:
          'postgresql://evorto:secret@localhost:5432/evorto_postgres_integration?host=production.example.com',
      },
      message: 'unsupported connection parameters: host',
    },
  ])('rejects unsafe targets: $message', async ({ environment, message }) => {
    await expect(
      resolvePostgresIntegrationEnvironment({ environment }),
    ).rejects.toThrow(message);
  });
});
