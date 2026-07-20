import type { Pool } from 'pg';

import { getTableName, isTable } from 'drizzle-orm';

import * as schema from './schema';

export const stagingTenantDomain = 'staging.evorto.app';

export const applicationTableNames = [
  ...new Set(
    Object.values(schema).flatMap((value) =>
      isTable(value) ? [getTableName(value)] : [],
    ),
  ),
].toSorted();

export type StagingDatabaseInitializationState =
  'empty' | 'inconsistent' | 'initialized';

export interface StagingDatabaseProbe {
  readonly hasStagingTenant: () => Promise<boolean>;
  readonly tableHasRows: (tableName: string) => Promise<boolean>;
}

export const resolveStagingDatabaseInitializationState = async (
  probe: StagingDatabaseProbe,
  tableNames: readonly string[] = applicationTableNames,
): Promise<StagingDatabaseInitializationState> => {
  if (await probe.hasStagingTenant()) {
    return 'initialized';
  }

  for (const tableName of tableNames) {
    if (await probe.tableHasRows(tableName)) {
      return 'inconsistent';
    }
  }

  return 'empty';
};

const quoteIdentifier = (identifier: string) =>
  `"${identifier.replaceAll('"', '""')}"`;

export const inspectStagingDatabaseInitialization = (pool: Pool) =>
  resolveStagingDatabaseInitializationState({
    hasStagingTenant: async () => {
      const result = await pool.query<{ exists: boolean }>(
        'SELECT EXISTS (SELECT 1 FROM "tenants" WHERE "domain" = $1) AS "exists"',
        [stagingTenantDomain],
      );
      return result.rows[0]?.exists === true;
    },
    tableHasRows: async (tableName) => {
      const result = await pool.query<{ exists: boolean }>(
        `SELECT EXISTS (SELECT 1 FROM ${quoteIdentifier(tableName)}) AS "exists"`,
      );
      return result.rows[0]?.exists === true;
    },
  });
