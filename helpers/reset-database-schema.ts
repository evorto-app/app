import { resetPublicSchema } from './testing/reset-public-schema';

const databaseUrlValue = process.env['DATABASE_URL']?.trim();
const confirmation = process.env['LOCAL_DATABASE_CONFIRM_RESET']?.trim();
const localHosts = new Set(['127.0.0.1', '::1', 'db', 'localhost']);

if (!databaseUrlValue) {
  throw new Error('DATABASE_URL must be configured for schema reset');
}
if (confirmation !== 'evorto-local-reset') {
  throw new Error(
    'Set LOCAL_DATABASE_CONFIRM_RESET=evorto-local-reset to confirm a destructive local schema reset',
  );
}

const databaseUrl = new URL(databaseUrlValue);
const host = databaseUrl.hostname.replace(/^\[(.*)\]$/u, '$1');
if (!localHosts.has(host)) {
  throw new Error(
    `Refusing to reset a non-local database host (${host || 'missing'})`,
  );
}

await resetPublicSchema({ databaseUrl: databaseUrl.toString() });
