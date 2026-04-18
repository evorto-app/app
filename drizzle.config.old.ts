import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dbCredentials: {
    url: process.env['NEON_PROD_CONNECTION']!,
  },
  dialect: 'postgresql',
  out: './old/drizzle',
  schema: './old/drizzle/*.ts',
  // Always ask for confirmation
  strict: true,
  // Print all statements
  verbose: true,
});
