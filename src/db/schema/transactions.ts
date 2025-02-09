import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventInstances } from './event-instances';
import { eventRegistrations } from './event-registrations';
import { modelOfTenant } from './model';
import { currencyEnum } from './tenants';
import { users } from './users';

export const transactionStatus = pgEnum('transaction_status', [
  'pending',
  'successful',
  'cancelled',
]);

export const transactionMethod = pgEnum('transaction_method', [
  'stripe',
  'transfer',
  'paypal',
  'cash',
]);

export const transactionType = pgEnum('transaction_type', [
  'registration',
  'refund',
  'other',
]);

export const transactions = pgTable('transactions', {
  ...modelOfTenant,
  amount: integer().notNull(),
  appFee: integer(),
  comment: text(),
  currency: currencyEnum().notNull(),
  eventId: varchar({ length: 20 }).references(() => eventInstances.id),
  eventRegistrationId: varchar({ length: 20 }).references(
    () => eventRegistrations.id,
  ),
  executiveUserId: varchar({ length: 20 }).references(() => users.id),
  manuallyCreated: boolean().default(false),
  method: transactionMethod().notNull(),
  status: transactionStatus().notNull(),
  stripeChargeId: varchar().unique(),
  stripeCheckoutSessionId: varchar().unique(),
  stripeCheckoutUrl: varchar().unique(),
  stripeFee: integer(),
  stripePaymentIntentId: varchar().unique(),
  targetUserId: varchar({ length: 20 }).references(() => users.id),
  type: transactionType().notNull(),
});
