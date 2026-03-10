import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { loadDatabaseConfigSync } from '../server/config/database-config';
import { relations } from './relations';

const { DATABASE_URL: databaseUrl } = loadDatabaseConfigSync();
const pool = new Pool({
  connectionString: databaseUrl,
});

export const database = drizzle({
  client: pool,
  relations,
});
