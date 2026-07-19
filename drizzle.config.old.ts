import { defineConfig } from 'drizzle-kit';

const legacyDatabaseUrl = process.env['LEGACY_DATABASE_URL'];
if (!legacyDatabaseUrl) {
  throw new Error('LEGACY_DATABASE_URL must be configured');
}

export default defineConfig({
  dbCredentials: {
    url: legacyDatabaseUrl,
  },
  dialect: 'postgresql',
  out: './old/drizzle',
  schema: './old/drizzle/*.ts',
  // Always ask for confirmation
  strict: true,
  // Print all statements
  verbose: true,
});
