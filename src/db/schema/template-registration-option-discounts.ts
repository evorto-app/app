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
import { discountTypes } from './global-enums';
import { templateRegistrationOptions } from './template-registration-options';

export const templateDiscountOptionOwnerForeignKeyName =
  'template_option_discounts_option_template_fk';
export const templateDiscountOptionTypeUniqueConstraintName =
  'template_option_discounts_option_type_unique';
export const templateDiscountPriceNonnegativeCheckName =
  'template_option_discounts_price_nonnegative';

export const templateRegistrationOptionDiscounts = pgTable(
  'template_registration_option_discounts',
  {
    createdAt: timestamp().notNull().defaultNow(),
    discountedPrice: integer().notNull(),
    discountType: discountTypes().notNull(),
    id: varchar({ length: 20 })
      .$defaultFn(() => createId())
      .primaryKey(),
    registrationOptionId: varchar({ length: 20 }).notNull(),
    templateId: varchar({ length: 20 }).notNull(),
    updatedAt: timestamp()
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    check(
      templateDiscountPriceNonnegativeCheckName,
      sql`${table.discountedPrice} >= 0`,
    ),
    foreignKey({
      columns: [table.registrationOptionId, table.templateId],
      foreignColumns: [
        templateRegistrationOptions.id,
        templateRegistrationOptions.templateId,
      ],
      name: templateDiscountOptionOwnerForeignKeyName,
    }).onDelete('cascade'),
    unique(templateDiscountOptionTypeUniqueConstraintName).on(
      table.registrationOptionId,
      table.discountType,
    ),
  ],
);
