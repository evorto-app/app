import { resetPublicSchema } from './testing/reset-public-schema';
import { resolveLocalDatabaseEnvironment } from './local-database-preflight';

const confirmation = process.env['LOCAL_DATABASE_CONFIRM_RESET']?.trim();
if (confirmation !== 'evorto-local-reset') {
  throw new Error(
    'Set LOCAL_DATABASE_CONFIRM_RESET=evorto-local-reset to confirm a destructive local schema reset',
  );
}

const { databaseUrl } = resolveLocalDatabaseEnvironment();

await resetPublicSchema({ databaseUrl });
