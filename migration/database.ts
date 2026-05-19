import { createDatabaseClient } from '../src/db/database-client';

const databaseUrl = process.env['DATABASE_URL'];

if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured for migrations');
}

const client = createDatabaseClient(
  databaseUrl,
  process.env['NEON_LOCAL_PROXY'] === 'true',
);

export const database = client.database;
export const databasePool = client.pool;
