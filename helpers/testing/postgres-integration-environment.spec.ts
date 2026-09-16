import { inspect } from 'node:util';
import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

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
  it('accepts only the named disposable loopback database', async () => {
    await expect(
      resolvePostgresIntegrationEnvironment({
        environment: localEnvironment,
      }),
    ).resolves.toEqual({
      databaseName: 'evorto_postgres_integration',
      databaseUrl:
        'postgresql://evorto:secret@localhost:5432/evorto_postgres_integration',
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
    expect(resolved.databaseUrl).toBe(databaseUrl);
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
        'postgresql://evorto:secret@[::1]:5432/evorto_postgres_integration',
    });
  });

  it('keeps every child command on the validated disposable database', async () => {
    const integrationEnvironment = await resolvePostgresIntegrationEnvironment({
      environment: localEnvironment,
    });

    expect(postgresIntegrationChildEnvironment(integrationEnvironment)).toEqual(
      {
        DATABASE_TLS_REQUIRED: 'false',
        DATABASE_URL:
          'postgresql://evorto:secret@localhost:5432/evorto_postgres_integration',
        POSTGRES_DB: 'evorto_postgres_integration',
      },
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
