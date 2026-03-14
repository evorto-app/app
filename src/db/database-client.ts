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
    database: drizzle({
      client: pool,
      relations,
    }),
    pool,
  };
};
