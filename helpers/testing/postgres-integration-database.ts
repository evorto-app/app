import { Pool } from 'pg';

import { createNodePgPoolConfig } from '../../src/db/pg-connection-config';
import { postgresIntegrationDatabaseName } from './postgres-integration-environment';

const createIntegrationDatabaseSql = `CREATE DATABASE "${postgresIntegrationDatabaseName}"`;

export interface PostgresIntegrationDatabaseActions {
  readonly create: () => Promise<void>;
  readonly exists: () => Promise<boolean>;
}

export const ensurePostgresIntegrationDatabase = async (
  actions: PostgresIntegrationDatabaseActions,
): Promise<void> => {
  if (await actions.exists()) return;
  await actions.create();
};

export const postgresMaintenanceDatabaseUrl = (databaseUrl: string): string => {
  const maintenanceUrl = new URL(databaseUrl);
  maintenanceUrl.pathname = '/postgres';
  return maintenanceUrl.toString();
};

export const ensureLocalPostgresIntegrationDatabase = async ({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): Promise<void> => {
  const pool = new Pool(
    createNodePgPoolConfig({
      databaseUrl: postgresMaintenanceDatabaseUrl(databaseUrl),
    }),
  );

  try {
    await ensurePostgresIntegrationDatabase({
      create: async () => {
        await pool.query(createIntegrationDatabaseSql);
      },
      exists: async () => {
        const result = await pool.query<{ exists: boolean }>(
          'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS "exists"',
          [postgresIntegrationDatabaseName],
        );
        return result.rows[0]?.exists === true;
      },
    });
  } finally {
    await pool.end();
  }
};
