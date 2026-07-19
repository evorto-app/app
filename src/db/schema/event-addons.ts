import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventInstances } from './event-instances';
import { eventRegistrationOptions } from './event-registration-options';

export const eventAddonEventIdentityUniqueConstraintName =
  'event_addons_id_event_unique';

export const eventAddons = pgTable(
  'event_addons',
  {
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
  },
  (table) => [
    check(
      'event_addons_max_quantity_per_user_positive',
      sql`${table.maxQuantityPerUser} > 0`,
    ),
    check('event_addons_price_nonnegative', sql`${table.price} >= 0`),
    check(
      'event_addons_stock_nonnegative',
      sql`${table.totalAvailableQuantity} >= 0`,
    ),
    check(
      'event_addons_paid_price_consistent',
      sql`(${table.isPaid} AND ${table.price} > 0) OR (NOT ${table.isPaid} AND ${table.price} = 0)`,
    ),
    unique(eventAddonEventIdentityUniqueConstraintName).on(
      table.id,
      table.eventId,
    ),
  ],
);

export const addonToEventRegistrationOptions = pgTable(
  'addon_to_event_registration_options',
  {
    addonId: varchar({ length: 20 }).notNull(),
    eventId: varchar({ length: 20 })
      .notNull()
      .references(() => eventInstances.id, { onDelete: 'cascade' }),
    includedQuantity: integer('included_quantity').notNull().default(0),
    optionalPurchaseQuantity: integer('optional_purchase_quantity')
      .notNull()
      .default(0),
    registrationOptionId: varchar({ length: 20 }).notNull(),
  },
  (table) => [
    check(
      'addon_to_event_registration_options_included_nonnegative',
      sql`${table.includedQuantity} >= 0`,
    ),
    check(
      'addon_to_event_registration_options_optional_nonnegative',
      sql`${table.optionalPurchaseQuantity} >= 0`,
    ),
    check(
      'addon_to_event_registration_options_quantity_present',
      sql`${table.includedQuantity} + ${table.optionalPurchaseQuantity} > 0`,
    ),
    foreignKey({
      columns: [table.addonId, table.eventId],
      foreignColumns: [eventAddons.id, eventAddons.eventId],
      name: 'addon_to_event_options_addon_event_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [table.registrationOptionId, table.eventId],
      foreignColumns: [
        eventRegistrationOptions.id,
        eventRegistrationOptions.eventId,
      ],
      name: 'addon_to_event_options_option_event_fk',
    }).onDelete('cascade'),
    index().on(table.addonId),
    index().on(table.registrationOptionId),
    index().on(table.registrationOptionId, table.addonId),
    primaryKey({
      columns: [table.addonId, table.registrationOptionId],
    }),
    unique('addon_to_event_options_addon_option_event_unique').on(
      table.addonId,
      table.registrationOptionId,
      table.eventId,
    ),
  ],
);
