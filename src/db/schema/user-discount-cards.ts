import {
  jsonb,
  pgEnum,
  pgTable,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { discountTypes } from './global-enums';
import { modelBasics } from './model';
import { tenants } from './tenants';
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
    tenantId: varchar({ length: 20 })
      .notNull()
      .references(() => tenants.id),
    type: discountTypes().notNull(),
    userId: varchar({ length: 20 })
      .notNull()
      .references(() => users.id),
    validFrom: timestamp(),
    validTo: timestamp(),
  },
  (table) => ({
    uniqueByUser: unique().on(table.userId, table.tenantId, table.type),
    uniqueIdentifier: unique().on(table.tenantId, table.type, table.identifier),
  }),
);
