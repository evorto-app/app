import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured for drizzle-kit');
}

const useNeonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';
const databaseUrlObject = new URL(databaseUrl);
const databaseName = databaseUrlObject.pathname.replace(/^\/+/, '');
const normalizeDatabaseHost = (host: string) =>
  host.replace(/^\[(.*)\]$/, '$1');
const databaseHost = normalizeDatabaseHost(databaseUrlObject.hostname);
const neonLocalHosts = new Set(['127.0.0.1', '::1', 'db', 'localhost']);

if (!databaseName) {
  throw new Error('DATABASE_URL must include a database name for drizzle-kit');
}

if (useNeonLocalProxy && !neonLocalHosts.has(databaseHost)) {
  throw new Error(
    `NEON_LOCAL_PROXY only supports localhost or docker db hosts. Received "${databaseHost}".`,
  );
}

export default defineConfig({
  dbCredentials: useNeonLocalProxy
    ? {
        database: databaseName,
        host: databaseHost,
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
