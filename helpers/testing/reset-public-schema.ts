import { Pool } from 'pg';

import { createNodePgPoolConfig } from '../../src/db/pg-connection-config';

export const resetPublicSchema = async ({
  databaseUrl,
}: {
  readonly databaseUrl: string;
}): Promise<void> => {
  const pool = new Pool(
    createNodePgPoolConfig({
      databaseUrl,
    }),
  );

  try {
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
    }
  } finally {
    await pool.end();
  }
};
