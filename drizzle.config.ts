import { neonConfig } from '@neondatabase/serverless';
import { defineConfig } from 'drizzle-kit';

// Configure neon-local for serverless driver when using local database
if (process.env['DATABASE_URL']?.includes('db:5432')) {
  neonConfig.fetchEndpoint = 'http://db:5432/sql';
}
if (process.env['DATABASE_URL']?.includes('localhost:5432')) {
  neonConfig.fetchEndpoint = 'http://localhost:5432/sql';
}

export default defineConfig({
  dbCredentials: {
    url: process.env['DATABASE_URL']!,
  },
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/schema/index.ts',
});
