import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { relations } from './relations';

export const createDatabaseClient = (databaseUrl: string) => {
  const pool = new Pool({
    connectionString: databaseUrl,
  });

  return {
    database: drizzle({
      client: pool,
      relations,
    }),
    pool,
  };
};
