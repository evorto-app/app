import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { createId } from '../create-id';
import { eventTemplates } from './event-templates';

export const templateAddonTemplateIdentityUniqueConstraintName =
  'template_event_addons_id_template_unique';

export const templateEventAddons = pgTable(
  'template_event_addons',
  {
    allowMultiple: boolean().notNull(),
    allowPurchaseBeforeEvent: boolean().notNull(),
    allowPurchaseDuringEvent: boolean().notNull(),
    allowPurchaseDuringRegistration: boolean().notNull(),
    createdAt: timestamp().notNull().defaultNow(),
    description: text(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    isPaid: boolean().notNull(),
    maxQuantityPerUser: integer().notNull(),
    price: integer().notNull(),
    stripeTaxRateId: varchar(),
    templateId: varchar({ length: 20 })
      .notNull()
      .references(() => eventTemplates.id, { onDelete: 'cascade' }),
    title: text().notNull(),
    totalAvailableQuantity: integer().notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      'template_event_addons_max_quantity_per_user_positive',
      sql`${table.maxQuantityPerUser} > 0`,
    ),
    check('template_event_addons_price_nonnegative', sql`${table.price} >= 0`),
    check(
      'template_event_addons_stock_nonnegative',
      sql`${table.totalAvailableQuantity} >= 0`,
    ),
    check(
      'template_event_addons_paid_price_consistent',
      sql`(${table.isPaid} AND ${table.price} > 0) OR (NOT ${table.isPaid} AND ${table.price} = 0)`,
    ),
    unique(templateAddonTemplateIdentityUniqueConstraintName).on(
      table.id,
      table.templateId,
    ),
  ],
);
