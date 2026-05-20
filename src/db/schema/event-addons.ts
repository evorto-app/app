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
import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';

export const eventAddons = pgTable('event_addons', {
  allowMultiple: boolean().notNull(),
  allowPurchaseBeforeEvent: boolean().notNull(),
  allowPurchaseDuringEvent: boolean().notNull(),
  allowPurchaseDuringRegistration: boolean().notNull(),
  createdAt: timestamp().notNull().defaultNow(),
  description: text(),
  eventId: varchar({ length: 20 })
    .notNull()
    .references(() => eventInstances.id),
  id: varchar({ length: 20 })
    .$defaultFn(() => createId())
    .primaryKey(),
  isPaid: boolean().notNull(),
  maxQuantityPerUser: integer().notNull(),
  price: integer().notNull(),
  stripeTaxRateId: varchar(),
  title: text().notNull(),
  totalAvailableQuantity: integer().notNull(),
  updatedAt: timestamp()
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const addonToEventRegistrationOptions = pgTable(
  'addon_to_event_registration_options',
  {
    addonId: varchar({ length: 20 })
      .notNull()
      .references(() => eventAddons.id),
    quantity: integer().notNull(),
    registrationOptionId: varchar({ length: 20 })
      .notNull()
      .references(() => eventRegistrationOptions.id),
  },
  (table) => ({
    unique: unique().on(table.addonId, table.registrationOptionId),
  }),
);
