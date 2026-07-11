import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';

import {
  parsePostgresIntegrationTarget,
  resolvePostgresIntegrationEnvironment,
} from './postgres-integration-environment';

const localEnvironment = {
  POSTGRES_INTEGRATION_DATABASE_URL:
    'postgresql://evorto:secret@localhost:5432/evorto_postgres_integration',
  POSTGRES_INTEGRATION_DISPOSABLE: 'true',
};

describe('PostgreSQL integration environment', () => {
  it('accepts only the named disposable loopback database', () => {
    expect(parsePostgresIntegrationTarget(localEnvironment)).toEqual({
      _tag: 'Local',
      databaseUrl:
        'postgresql://evorto:secret@localhost:5432/evorto_postgres_integration',
    });
  });

  it('accepts the named disposable database through IPv6 loopback', () => {
    expect(
      parsePostgresIntegrationTarget({
        ...localEnvironment,
        POSTGRES_INTEGRATION_DATABASE_URL:
          'postgresql://evorto:secret@[::1]:5432/evorto_postgres_integration',
      }),
    ).toEqual({
      _tag: 'Local',
      databaseUrl:
        'postgresql://evorto:secret@[::1]:5432/evorto_postgres_integration',
    });
  });

  it('does not retain malformed database URL credentials in parse errors', () => {
    const sentinelUsername = 'sentinel-integration-username';
    const sentinelPassword = 'sentinel-integration-password';
    let thrown: unknown;

    try {
      parsePostgresIntegrationTarget({
        ...localEnvironment,
        POSTGRES_INTEGRATION_DATABASE_URL: `postgresql://${sentinelUsername}:${sentinelPassword}@localhost:99999/appdb`,
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
        NEON_API_KEY: 'api-key',
        NEON_PROJECT_ID: 'project-id',
        POSTGRES_INTEGRATION_DATABASE_URL:
          'postgresql://appdb_owner:secret@example.com/appdb',
      },
      message: 'POSTGRES_INTEGRATION_NEON_BRANCH_ID',
    },
    {
      environment: {
        ...localEnvironment,
        POSTGRES_INTEGRATION_DATABASE_URL:
          'postgresql://evorto:secret@localhost:5432/evorto_postgres_integration?host=production.example.com',
      },
      message: 'unsupported connection parameters: host',
    },
    {
      environment: {
        ...localEnvironment,
        POSTGRES_INTEGRATION_DATABASE_URL:
          'postgresql://evorto:secret@localhost:5432/evorto_postgres_integration?connectionString=postgresql%3A%2F%2Fevorto%3Asecret%40production.example.com%2Fappdb',
      },
      message: 'unsupported connection parameters: connectionString',
    },
  ])('rejects unsafe targets: $message', ({ environment, message }) => {
    expect(() => parsePostgresIntegrationTarget(environment)).toThrow(message);
  });

  it('requires complete Neon ownership metadata for remote targets', () => {
    expect(
      parsePostgresIntegrationTarget({
        NEON_API_KEY: 'api-key',
        NEON_PROJECT_ID: 'project-id',
        POSTGRES_INTEGRATION_DATABASE_URL:
          'postgresql://appdb_owner:secret@example.neon.tech/appdb',
        POSTGRES_INTEGRATION_DISPOSABLE: 'true',
        POSTGRES_INTEGRATION_NEON_BRANCH_ID: 'br-test',
      }),
    ).toEqual({
      _tag: 'Neon',
      apiKey: 'api-key',
      branchId: 'br-test',
      databaseUrl:
        'postgresql://appdb_owner:secret@example.neon.tech/appdb?sslmode=verify-full',
      projectId: 'project-id',
    });
  });

  it('normalizes approved Neon transport parameters without retaining target overrides', () => {
    expect(
      parsePostgresIntegrationTarget({
        NEON_API_KEY: 'api-key',
        NEON_PROJECT_ID: 'project-id',
        POSTGRES_INTEGRATION_DATABASE_URL:
          'postgresql://appdb_owner:secret@example.neon.tech/appdb?sslmode=require&channel_binding=require',
        POSTGRES_INTEGRATION_DISPOSABLE: 'true',
        POSTGRES_INTEGRATION_NEON_BRANCH_ID: 'br-test',
      }),
    ).toMatchObject({
      databaseUrl:
        'postgresql://appdb_owner:secret@example.neon.tech/appdb?channel_binding=require&sslmode=verify-full',
    });
  });

  it('verifies an expiring Neon branch and exact endpoint before use', async () => {
    const now = Date.parse('2026-07-11T09:00:00Z');
    const fetchImplementation: typeof fetch = async (input) => {
      const url = String(input);
      const payload = url.endsWith('/branches/br-test')
        ? {
            branch: {
              default: false,
              expires_at: '2026-07-11T15:00:00Z',
              id: 'br-test',
              name: 'codex-postgres-integration-test',
              protected: false,
            },
          }
        : {
            endpoints: [
              {
                branch_id: 'br-test',
                disabled: false,
                host: 'ep-test.neon.tech',
                type: 'read_write',
              },
            ],
          };

      return Response.json(payload, {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    };

    await expect(
      resolvePostgresIntegrationEnvironment({
        environment: {
          NEON_API_KEY: 'api-key',
          NEON_PROJECT_ID: 'project-id',
          POSTGRES_INTEGRATION_DATABASE_URL:
            'postgresql://appdb_owner:secret@ep-test.neon.tech/appdb',
          POSTGRES_INTEGRATION_DISPOSABLE: 'true',
          POSTGRES_INTEGRATION_NEON_BRANCH_ID: 'br-test',
        },
        fetchImplementation,
        now,
      }),
    ).resolves.toEqual({
      databaseUrl:
        'postgresql://appdb_owner:secret@ep-test.neon.tech/appdb?sslmode=verify-full',
      neonLocalProxy: false,
    });
  });

  it('refuses a default Neon branch even when its endpoint matches', async () => {
    const fetchImplementation: typeof fetch = async (input) => {
      const url = String(input);
      const payload = url.endsWith('/branches/br-test')
        ? {
            branch: {
              default: true,
              expires_at: '2026-07-11T15:00:00Z',
              id: 'br-test',
              name: 'codex-postgres-integration-test',
              protected: false,
            },
          }
        : {
            endpoints: [
              {
                branch_id: 'br-test',
                disabled: false,
                host: 'ep-test.neon.tech',
                type: 'read_write',
              },
            ],
          };

      return Response.json(payload, { status: 200 });
    };

    await expect(
      resolvePostgresIntegrationEnvironment({
        environment: {
          NEON_API_KEY: 'api-key',
          NEON_PROJECT_ID: 'project-id',
          POSTGRES_INTEGRATION_DATABASE_URL:
            'postgresql://appdb_owner:secret@ep-test.neon.tech/appdb',
          POSTGRES_INTEGRATION_DISPOSABLE: 'true',
          POSTGRES_INTEGRATION_NEON_BRANCH_ID: 'br-test',
        },
        fetchImplementation,
        now: Date.parse('2026-07-11T09:00:00Z'),
      }),
    ).rejects.toThrow(
      'Refusing to reset a default, protected, or mismatched Neon branch',
    );
  });
});
