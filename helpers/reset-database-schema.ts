import { Pool } from 'pg';

import { createNodePgPoolConfig } from '../src/db/pg-connection-config';

// Docker startup uses this only for disposable dev/test databases so Drizzle
// can push the current schema from a clean `public` schema without prompts.
const databaseUrl = process.env['DATABASE_URL'];
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';

if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured for schema reset');
}
if (!neonLocalProxy) {
  throw new Error(
    'Refusing to reset schema without NEON_LOCAL_PROXY=true on a disposable local database',
  );
}

const pool = new Pool(
  createNodePgPoolConfig({
    databaseUrl,
    neonLocalProxy,
  }),
);
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query('DROP SCHEMA IF EXISTS public CASCADE');
  await client.query('CREATE SCHEMA public');
  await client.query('CREATE EXTENSION IF NOT EXISTS unaccent');
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await client.query(`
    CREATE OR REPLACE FUNCTION immutable_unaccent(value text)
    RETURNS text AS $$
      SELECT unaccent(value)
    $$ LANGUAGE sql IMMUTABLE;
  `);
  await client.query('COMMIT');
} catch (error) {
  try {
    await client.query('ROLLBACK');
  } catch {
    // Preserve the schema-reset failure; rollback can fail after broken DDL.
  }
  throw error;
} finally {
  client.release();
  await pool.end();
}
