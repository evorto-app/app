import { createNodePgPoolConfig } from '@db/pg-connection-config';
import { Pool } from 'pg';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured for database prerequisites');
}

const tlsRequired = process.env['DATABASE_TLS_REQUIRED'] === 'true';
const caCertificate = process.env['DATABASE_TLS_CA_CERTIFICATE'];
const tlsServerName = process.env['DATABASE_TLS_SERVER_NAME'];
const runtimeRole = process.env['DATABASE_RUNTIME_ROLE'];
if (tlsRequired && !caCertificate) {
  throw new Error(
    'DATABASE_TLS_CA_CERTIFICATE is required when DATABASE_TLS_REQUIRED=true',
  );
}
if (!runtimeRole || !/^[a-z_][a-z0-9_]{0,62}$/u.test(runtimeRole)) {
  throw new Error('DATABASE_RUNTIME_ROLE must be a safe PostgreSQL role name');
}

const quotedRuntimeRole = `"${runtimeRole}"`;

const pool = new Pool(
  createNodePgPoolConfig({
    caCertificate,
    databaseUrl,
    pool: {
      connectTimeoutMs: 10_000,
      idleTimeoutMs: 10_000,
      max: 1,
      min: 0,
    },
    tlsServerName,
  }),
);

try {
  await pool.query('CREATE EXTENSION IF NOT EXISTS unaccent');
  await pool.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
  await pool.query(`
    CREATE OR REPLACE FUNCTION public.immutable_unaccent(value text)
    RETURNS text
    LANGUAGE sql
    IMMUTABLE
    PARALLEL SAFE
    STRICT
    AS $$ SELECT public.unaccent(value) $$
  `);
  await pool.query(`GRANT USAGE ON SCHEMA public TO ${quotedRuntimeRole}`);
  await pool.query(`
    GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public
    TO ${quotedRuntimeRole}
  `);
  await pool.query(`
    GRANT USAGE, SELECT, UPDATE
    ON ALL SEQUENCES IN SCHEMA public
    TO ${quotedRuntimeRole}
  `);
  await pool.query(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
    TO ${quotedRuntimeRole}
  `);
  await pool.query(`
    ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT, UPDATE ON SEQUENCES
    TO ${quotedRuntimeRole}
  `);
} finally {
  await pool.end();
}
