import {
  boolean,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventInstances } from './event-instances';
import { modelOfTenant } from './model';
import { transactions } from './transactions';
import { users } from './users';

export const financeReceiptStatus = pgEnum('finance_receipt_status', [
  'submitted',
  'approved',
  'rejected',
  'refunded',
]);

export const financeReceipts = pgTable('finance_receipts', {
  ...modelOfTenant,
  alcoholAmount: integer().notNull().default(0),
  attachmentFileName: text().notNull(),
  attachmentMimeType: text().notNull(),
  attachmentSizeBytes: integer().notNull(),
  attachmentStorageKey: text(),
  attachmentStorageUrl: text(),
  depositAmount: integer().notNull().default(0),
  eventId: varchar({ length: 20 })
    .notNull()
    .references(() => eventInstances.id),
  hasAlcohol: boolean().notNull().default(false),
  hasDeposit: boolean().notNull().default(false),
  previewImageId: text(),
  previewImageUrl: text(),
  purchaseCountry: text().notNull(),
  receiptDate: timestamp().notNull(),
  refundedAt: timestamp(),
  refundedByUserId: varchar({ length: 20 }).references(() => users.id),
  refundTransactionId: varchar({ length: 20 }).references(() => transactions.id),
  rejectionReason: text(),
  reviewedAt: timestamp(),
  reviewedByUserId: varchar({ length: 20 }).references(() => users.id),
  status: financeReceiptStatus().notNull().default('submitted'),
  stripeTaxRateId: varchar().notNull(),
  submittedByUserId: varchar({ length: 20 })
    .notNull()
    .references(() => users.id),
  totalAmount: integer().notNull(),
});
