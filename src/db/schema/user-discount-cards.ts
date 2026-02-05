import {
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { discountTypes } from './global-enums';
import { modelOfTenant } from './model';
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
    ...modelOfTenant,
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
    uniqueByUser: unique().on(table.tenantId, table.userId, table.type),
    uniqueIdentifier: unique().on(table.type, table.identifier),
  }),
);
