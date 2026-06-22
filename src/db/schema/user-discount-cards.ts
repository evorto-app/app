import {
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  uniqueIndex,
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
    uniqueByUser: uniqueIndex('user_discount_cards_user_id_type_unique_idx').on(
      table.userId,
      table.type,
    ),
    uniqueIdentifier: unique().on(table.type, table.identifier),
  }),
);
