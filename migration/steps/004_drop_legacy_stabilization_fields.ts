import consola from 'consola';
import { sql } from 'drizzle-orm';

import { database } from '../database';

export const dropLegacyStabilizationFields = async () => {
  consola.info('Dropping legacy stabilization fields');

  try {
    await database.execute(sql`
      ALTER TABLE IF EXISTS "roles"
      DROP COLUMN IF EXISTS "showInHub"
    `);
    consola.info('Dropped roles.showInHub when present');

    await database.execute(sql`
      ALTER TABLE IF EXISTS "event_registrations"
      DROP COLUMN IF EXISTS "paymentStatus"
    `);
    consola.info('Dropped event_registrations.paymentStatus when present');

    await database.execute(sql`
      DROP TYPE IF EXISTS "payment_status"
    `);
    consola.success('Dropped legacy payment_status enum when present');
  } catch (error) {
    consola.error('Failed to drop legacy stabilization fields:', error);
    throw error;
  }
};
