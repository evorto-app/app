import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured for drizzle-kit');
}

export default defineConfig({
  dbCredentials: { url: databaseUrl },
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/schema/index.ts',
});
