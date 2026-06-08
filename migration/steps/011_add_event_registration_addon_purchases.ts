import consola from 'consola';
import { sql } from 'drizzle-orm';

import { database } from '../database';

export const addEventRegistrationAddonPurchases = async () => {
  consola.info('Adding registration add-on purchase table');

  await database.execute(sql`
    CREATE TABLE IF NOT EXISTS template_event_addons (
      id varchar(20) PRIMARY KEY,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      template_id varchar(20) NOT NULL REFERENCES event_templates(id) ON DELETE CASCADE,
      title text NOT NULL,
      description text,
      is_paid boolean NOT NULL,
      price integer NOT NULL,
      stripe_tax_rate_id varchar,
      total_available_quantity integer NOT NULL,
      max_quantity_per_user integer NOT NULL,
      allow_multiple boolean NOT NULL,
      allow_purchase_before_event boolean NOT NULL,
      allow_purchase_during_registration boolean NOT NULL,
      allow_purchase_during_event boolean NOT NULL
    );

    CREATE TABLE IF NOT EXISTS addon_to_template_registration_options (
      addon_id varchar(20) NOT NULL REFERENCES template_event_addons(id) ON DELETE CASCADE,
      registration_option_id varchar(20) NOT NULL REFERENCES template_registration_options(id) ON DELETE CASCADE,
      quantity integer NOT NULL,
      PRIMARY KEY (addon_id, registration_option_id)
    );

    CREATE TABLE IF NOT EXISTS event_addons (
      id varchar(20) PRIMARY KEY,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      event_id varchar(20) NOT NULL REFERENCES event_instances(id) ON DELETE CASCADE,
      title text NOT NULL,
      description text,
      is_paid boolean NOT NULL,
      price integer NOT NULL,
      stripe_tax_rate_id varchar,
      total_available_quantity integer NOT NULL,
      max_quantity_per_user integer NOT NULL,
      allow_multiple boolean NOT NULL,
      allow_purchase_before_event boolean NOT NULL,
      allow_purchase_during_registration boolean NOT NULL,
      allow_purchase_during_event boolean NOT NULL
    );

    CREATE TABLE IF NOT EXISTS addon_to_event_registration_options (
      addon_id varchar(20) NOT NULL REFERENCES event_addons(id) ON DELETE CASCADE,
      registration_option_id varchar(20) NOT NULL REFERENCES event_registration_options(id) ON DELETE CASCADE,
      quantity integer NOT NULL,
      PRIMARY KEY (addon_id, registration_option_id)
    );

    CREATE TABLE IF NOT EXISTS event_registration_addon_purchases (
      id varchar(20) PRIMARY KEY,
      created_at timestamp NOT NULL DEFAULT now(),
      updated_at timestamp NOT NULL DEFAULT now(),
      registration_id varchar(20) NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
      addon_id varchar(20) NOT NULL REFERENCES event_addons(id) ON DELETE RESTRICT,
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
