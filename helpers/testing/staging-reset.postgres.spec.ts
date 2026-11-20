import { Pool } from 'pg';
import { afterAll, expect, it } from 'vitest';

import { resolvePostgresIntegrationEnvironment } from './postgres-integration-environment';
import { createNodePgPoolConfig } from '../../src/db/pg-connection-config';
import { stagingResetSql } from '../../src/server/ops/staging-reset-sql';

const environment = await resolvePostgresIntegrationEnvironment({
  environment: {
    ...process.env,
    POSTGRES_INTEGRATION_DATABASE_URL: process.env['DATABASE_URL'],
  },
});
const pool = new Pool(
  createNodePgPoolConfig({ databaseUrl: environment.databaseUrl }),
);

afterAll(() => pool.end());

it('rebuilds app-owned objects with a non-owner role in managed public', async () => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE ROLE evorto_staging_reset_fixture NOSUPERUSER;
      GRANT USAGE, CREATE ON SCHEMA public TO evorto_staging_reset_fixture;
      CREATE TABLE public.reset_provider_fixture (id bigint);
      SET LOCAL ROLE evorto_staging_reset_fixture;
      CREATE TYPE public."reset-fixture-state" AS ENUM ('original');
      CREATE TABLE public.reset_parent_fixture (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        state public."reset-fixture-state" NOT NULL
      );
      CREATE TABLE public.reset_child_fixture (
        id bigint REFERENCES public.reset_parent_fixture (id)
      );
      CREATE VIEW public.reset_app_fixture AS SELECT id FROM public.reset_parent_fixture;
      INSERT INTO public.reset_parent_fixture (state) VALUES ('original');
      INSERT INTO public.reset_child_fixture (id) VALUES (1);
      RESET ROLE;
      CREATE VIEW public.reset_provider_dependency AS SELECT id FROM public.reset_parent_fixture;
      SET LOCAL ROLE evorto_staging_reset_fixture;
      SAVEPOINT before_reset;
    `);

    await expect(client.query(stagingResetSql)).rejects.toMatchObject({
      code: '2BP01',
    });
    await client.query('ROLLBACK TO SAVEPOINT before_reset');
    const retainedView = await client.query(
      'SELECT id FROM public.reset_app_fixture',
    );
    expect(retainedView.rows).toEqual([{ id: '1' }]);

    await client.query(`
      RESET ROLE;
      DROP VIEW public.reset_provider_dependency;
      SET LOCAL ROLE evorto_staging_reset_fixture;
    `);
    await client.query(stagingResetSql);
    await client.query(stagingResetSql);
    const result = await client.query(`
      SELECT
        pg_get_userbyid(nspowner) <> CURRENT_USER AS managed_schema,
        to_regclass('public.reset_provider_fixture') IS NOT NULL AS provider_table,
        to_regclass('public.reset_app_fixture') IS NULL AS app_view_removed,
        to_regclass('public.reset_parent_fixture') IS NULL AS parent_removed,
        to_regclass('public.reset_child_fixture') IS NULL AS child_removed,
        to_regclass('public.reset_parent_fixture_id_seq') IS NULL AS sequence_removed,
        to_regtype('public."reset-fixture-state"') IS NULL AS enum_removed
      FROM pg_namespace WHERE nspname = 'public'
    `);
    expect(result.rows).toEqual([
      {
        app_view_removed: true,
        child_removed: true,
        enum_removed: true,
        managed_schema: true,
        parent_removed: true,
        provider_table: true,
        sequence_removed: true,
      },
    ]);
  } finally {
    try {
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
  }
});
