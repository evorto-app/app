import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dbCredentials: {
    url: process.env['DATABASE_URL_LOCAL'] || 'postgres://neon:npg@localhost:5432/neondb?sslmode=no-verify',
  },
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/schema/index.ts',
});