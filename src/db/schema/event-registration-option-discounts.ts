import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  integer,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventRegistrationOptions } from './event-registration-options';
import { discountTypes } from './global-enums';

export const eventDiscountOptionOwnerForeignKeyName =
  'event_option_discounts_option_event_fk';
export const eventDiscountOptionTypeUniqueConstraintName =
  'event_option_discounts_option_type_unique';
export const eventDiscountPriceNonnegativeCheckName =
  'event_option_discounts_price_nonnegative';

export const eventRegistrationOptionDiscounts = pgTable(
  'event_registration_option_discounts',
  {
    createdAt: timestamp().notNull().defaultNow(),
    discountedPrice: integer().notNull(),
    discountType: discountTypes().notNull(),
    eventId: varchar({ length: 20 }).notNull(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    registrationOptionId: varchar({ length: 20 }).notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      eventDiscountPriceNonnegativeCheckName,
      sql`${table.discountedPrice} >= 0`,
    ),
    foreignKey({
      columns: [table.registrationOptionId, table.eventId],
      foreignColumns: [
        eventRegistrationOptions.id,
        eventRegistrationOptions.eventId,
      ],
      name: eventDiscountOptionOwnerForeignKeyName,
    }).onDelete('cascade'),
    unique(eventDiscountOptionTypeUniqueConstraintName).on(
      table.registrationOptionId,
      table.discountType,
    ),
  ],
);
