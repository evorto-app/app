import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

import { relations } from '../old/drizzle';

const legacyDatabaseUrl = process.env['LEGACY_DATABASE_URL'];
if (!legacyDatabaseUrl) {
  throw new Error(
    'LEGACY_DATABASE_URL must be configured for legacy migration',
  );
}

export const oldPool = new Pool({
  connectionString: legacyDatabaseUrl,
  max: 2,
});

export const oldDatabase = drizzle({
  client: oldPool,
  relations,
});
