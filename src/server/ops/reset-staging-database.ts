import { createNodePgPoolConfig } from '@db/pg-connection-config';
import { Pool } from 'pg';

if (process.env['APP_ENVIRONMENT'] !== 'staging') {
  throw new Error('The bounded database reset may run only in staging');
}
if (process.env['STAGING_RESET_CONFIRMATION'] !== 'reset-and-seed-staging') {
  throw new Error('The bounded database reset confirmation is missing');
}

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured for the staging reset');
}

const tlsRequired = process.env['DATABASE_TLS_REQUIRED'] === 'true';
const caCertificate = process.env['DATABASE_TLS_CA_CERTIFICATE'];
if (tlsRequired && !caCertificate) {
  throw new Error(
    'DATABASE_TLS_CA_CERTIFICATE is required when DATABASE_TLS_REQUIRED=true',
  );
}

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
  }),
);

try {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public AUTHORIZATION CURRENT_USER');
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      void rollbackError;
    }
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
