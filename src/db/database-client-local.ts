import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import * as schema from './schema';

// Create a local PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env['DATABASE_URL_LOCAL'] || 'postgresql://evorto:evorto_password@localhost:5432/evorto_local',
});

export const databaseLocal = drizzle(pool, { schema });