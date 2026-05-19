import consola from 'consola';
import { sql } from 'drizzle-orm';

import { database } from '../database';

export const addEventRegistrationCheckedInGuestCount = async () => {
  consola.info('Adding event registration checked_in_guest_count column');

  await database.execute(sql`
    ALTER TABLE event_registrations
    ADD COLUMN IF NOT EXISTS checked_in_guest_count integer NOT NULL DEFAULT 0
  `);

  consola.success(
    'Event registration checked_in_guest_count column is available',
  );
};
