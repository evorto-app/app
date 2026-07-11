import { resetPublicSchema } from './testing/reset-public-schema';

// Docker startup uses this only for disposable dev/test databases so Drizzle
// can push the current schema from a clean `public` schema without prompts.
const databaseUrl = process.env['DATABASE_URL'];
const neonLocalProxy = process.env['NEON_LOCAL_PROXY'] === 'true';

if (!databaseUrl) {
  throw new Error('DATABASE_URL must be configured for schema reset');
}
if (!neonLocalProxy) {
  throw new Error(
    'Refusing to reset schema without NEON_LOCAL_PROXY=true on a disposable local database',
  );
}

await resetPublicSchema({ databaseUrl, neonLocalProxy });
