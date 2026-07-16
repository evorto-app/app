import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { createNodePgPoolConfig } from './pg-connection-config';
import { relations } from './relations';

export const createDatabaseClient = (
  databaseUrl: string,
  neonLocalProxy = false,
) => {
  const pool = new Pool(
    createNodePgPoolConfig({
      databaseUrl,
      neonLocalProxy,
    }),
  );

  return {
    database: drizzle<typeof relations>({
      client: pool,
      relations,
    }),
    pool,
  };
};

export type ScriptDatabaseClient = ReturnType<
  typeof createDatabaseClient
>['database'];
