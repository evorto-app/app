import { Pool } from 'pg';

import { createNodePgPoolConfig } from '../src/db/pg-connection-config';

// Docker startup uses this only for disposable dev/test databases so Drizzle
// can push the current schema from a clean `public` schema without prompts.
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured for schema reset');
}

const pool = new Pool(
  createNodePgPoolConfig({
    databaseUrl,
    neonLocalProxy: process.env['NEON_LOCAL_PROXY'] === 'true',
  }),
);

try {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE');
  await pool.query('CREATE SCHEMA public');
  await pool.query('CREATE EXTENSION IF NOT EXISTS unaccent');
  await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await pool.query(`
    CREATE OR REPLACE FUNCTION immutable_unaccent(value text)
    RETURNS text AS $$
      SELECT unaccent(value)
    $$ LANGUAGE sql IMMUTABLE;
  `);
} finally {
  await pool.end();
}
