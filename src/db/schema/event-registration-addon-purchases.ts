import {
  boolean,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventAddons } from './event-addons';
import { eventRegistrations } from './event-registrations';

export const eventRegistrationAddonPurchases = pgTable(
  'event_registration_addon_purchases',
  {
    addonId: varchar({ length: 20 })
      .notNull()
      .references(() => eventAddons.id),
    createdAt: timestamp().notNull().defaultNow(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    quantity: integer().notNull(),
    registrationId: varchar({ length: 20 })
      .notNull()
      .references(() => eventRegistrations.id, { onDelete: 'cascade' }),
    taxRateDisplayName: text('tax_rate_name'),
    taxRateInclusive: boolean('tax_rate_inclusive'),
    taxRatePercentage: text('tax_rate_percentage'),
    unitPrice: integer('unit_price').notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    uniqueRegistrationAddonPurchase: unique().on(
      table.registrationId,
      table.addonId,
    ),
  }),
);
