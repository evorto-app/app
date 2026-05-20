import consola from 'consola';
import { sql } from 'drizzle-orm';

import { database } from '../database';

export const addEventRegistrationAddonPurchases = async () => {
  consola.info('Adding registration add-on purchase table');

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS event_registration_addon_purchases (
      id varchar(20) PRIMARY KEY,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      registration_id varchar(20) NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
      addon_id varchar(20) NOT NULL REFERENCES event_addons(id),
      quantity integer NOT NULL,
      unit_price integer NOT NULL,
      tax_rate_name text,
      tax_rate_inclusive boolean,
      tax_rate_percentage text,
      CONSTRAINT event_registration_addon_purchases_registration_addon_unique
        UNIQUE (registration_id, addon_id)
    )
  `);

  consola.success('Registration add-on purchase table is available');
};
