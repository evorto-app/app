import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import { resolvePostgresIntegrationEnvironment } from './postgres-integration-environment';

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
      databaseUrl:
        'postgresql://evorto:secret@localhost:5432/evorto_postgres_integration',
    });
  });

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
      databaseUrl:
        'postgresql://evorto:secret@[::1]:5432/evorto_postgres_integration',
    });
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
