import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
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
    .references(() => eventInstances.id, { onDelete: 'cascade' }),
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
      .references(() => eventAddons.id, { onDelete: 'cascade' }),
    quantity: integer().notNull(),
    registrationOptionId: varchar({ length: 20 })
      .notNull()
      .references(() => eventRegistrationOptions.id, { onDelete: 'cascade' }),
  },
  (table) => ({
    byAddonId: index().on(table.addonId),
    byRegistrationOptionId: index().on(table.registrationOptionId),
    byRegistrationOptionIdAndAddonId: index().on(
      table.registrationOptionId,
      table.addonId,
    ),
    pk: primaryKey({
      columns: [table.addonId, table.registrationOptionId],
    }),
  }),
);
