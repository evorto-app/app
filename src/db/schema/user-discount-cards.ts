import { sql } from 'drizzle-orm';
import {
  check,
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { discountTypes } from './global-enums';
import { modelBasics } from './model';
import { users } from './users';

export const discountCardStatus = pgEnum('discount_card_status', [
  'unverified',
  'verified',
  'expired',
  'invalid',
]);

export const userDiscountCardValidityWindowCheckName =
  'user_discount_cards_valid_status_requires_window';

export const userDiscountCardUserTypeUniqueConstraintName =
  'user_discount_cards_user_type_unique';
export const userDiscountCardIdentifierUniqueConstraintName =
  'user_discount_cards_type_identifier_unique';

export const userDiscountCards = pgTable(
  'user_discount_cards',
  {
    ...modelBasics,
    identifier: varchar({ length: 255 }).notNull(),
    lastCheckedAt: timestamp(),
    metadata: jsonb('metadata'),
    status: discountCardStatus().notNull().default('unverified'),
    type: discountTypes().notNull(),
    userId: varchar({ length: 20 })
      .notNull()
      .references(() => users.id),
    validFrom: timestamp(),
    validTo: timestamp(),
  },
  (table) => ({
    uniqueByUser: unique(userDiscountCardUserTypeUniqueConstraintName).on(
      table.userId,
      table.type,
    ),
    uniqueIdentifier: unique(userDiscountCardIdentifierUniqueConstraintName).on(
      table.type,
      table.identifier,
    ),
    validStatusRequiresWindow: check(
      userDiscountCardValidityWindowCheckName,
      sql`${table.status} not in ('verified', 'expired') or (${table.validFrom} is not null and ${table.validTo} is not null and ${table.validFrom} <= ${table.validTo})`,
    ),
  }),
);
