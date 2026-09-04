import { defineConfig } from 'drizzle-kit';

import { resolveLocalDatabaseEnvironment } from './helpers/local-database-preflight';

const { databaseUrl } = resolveLocalDatabaseEnvironment();

export default defineConfig({
  dbCredentials: { url: databaseUrl },
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/schema/index.ts',
});
