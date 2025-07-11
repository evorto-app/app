import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dbCredentials: {
    url: process.env['DATABASE_URL_LOCAL'] || 'postgresql://evorto:evorto_password@localhost:5432/evorto_local',
  },
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/schema/index.ts',
});