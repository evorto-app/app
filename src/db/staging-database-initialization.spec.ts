import { describe, expect, it, vi } from 'vitest';

import {
  applicationTableNames,
  resolveStagingDatabaseInitializationState,
} from './staging-database-initialization';

describe('staging database initialization', () => {
  it('treats an existing staging tenant as initialized without inspecting rows', async () => {
    const tableHasRows = vi.fn(async () => false);

    await expect(
      resolveStagingDatabaseInitializationState({
        hasStagingTenant: async () => true,
        tableHasRows,
      }),
    ).resolves.toBe('initialized');
    expect(tableHasRows).not.toHaveBeenCalled();
  });

  it('allows initialization only when every application table is empty', async () => {
    await expect(
      resolveStagingDatabaseInitializationState(
        {
          hasStagingTenant: async () => false,
          tableHasRows: async () => false,
        },
        ['tenants', 'users'],
      ),
    ).resolves.toBe('empty');
  });

  it('fails closed when data exists without the staging tenant', async () => {
    await expect(
      resolveStagingDatabaseInitializationState(
        {
          hasStagingTenant: async () => false,
          tableHasRows: async (tableName) => tableName === 'users',
        },
        ['tenants', 'users', 'events'],
      ),
    ).resolves.toBe('inconsistent');
  });

  it('derives the inspected table set from the Drizzle schema', () => {
    expect(applicationTableNames).toContain('tenants');
    expect(applicationTableNames).toContain('users');
    expect(applicationTableNames.length).toBeGreaterThan(40);
  });
});
