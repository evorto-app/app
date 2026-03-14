import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured for drizzle-kit');
}

const useNeonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';
const databaseUrlObject = new URL(databaseUrl);
const databaseName = databaseUrlObject.pathname.replace(/^\/+/, '');

if (!databaseName) {
  throw new Error('DATABASE_URL must include a database name for drizzle-kit');
}

export default defineConfig({
  dbCredentials: useNeonLocalProxy
    ? {
        database: databaseName,
        host: databaseUrlObject.hostname,
        password: decodeURIComponent(databaseUrlObject.password),
        port: Number.parseInt(databaseUrlObject.port || '5432', 10),
        ssl: {
          rejectUnauthorized: false,
        },
        user: decodeURIComponent(databaseUrlObject.username),
      }
    : {
        url: databaseUrl,
      },
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/schema/index.ts',
});
