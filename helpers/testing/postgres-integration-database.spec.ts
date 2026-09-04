import { describe, expect, it, vi } from '@effect/vitest';

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
