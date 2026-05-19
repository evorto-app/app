import consola from 'consola';
import { sql } from 'drizzle-orm';

import { database } from '../database';

export const addEventRegistrationGuestCount = async () => {
  consola.info('Adding event registration guest_count column');

  await database.execute(sql`
    ALTER TABLE event_registrations
    ADD COLUMN IF NOT EXISTS guest_count integer NOT NULL DEFAULT 0
  `);

  consola.success('Event registration guest_count column is available');
};
