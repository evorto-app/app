import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { getDatabaseEnvironment } from '../server/config/environment';
import { relations } from './relations';

const { DATABASE_URL: databaseUrl } = getDatabaseEnvironment();
const pool = new Pool({
  connectionString: databaseUrl,
});

export const database = drizzle({
  client: pool,
  relations,
});
