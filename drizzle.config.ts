import { defineConfig } from 'drizzle-kit';

import {
  neonLocalSslConfig,
  parseNeonLocalDatabaseUrl,
} from './src/db/pg-connection-config';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured for drizzle-kit');
}

const createDrizzleCredentials = (url: string) => {
  if (process.env['NEON_LOCAL_PROXY'] !== 'true') {
    return { url };
  }

  const { database, host, password, port, user } =
    parseNeonLocalDatabaseUrl(url);

  return {
    database,
    host,
    password,
    port,
    ssl: neonLocalSslConfig,
    user,
  };
};

export default defineConfig({
  dbCredentials: createDrizzleCredentials(databaseUrl),
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/schema/index.ts',
});
