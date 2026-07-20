import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  varchar,
} from 'drizzle-orm/pg-core';

import { eventInstances } from './event-instances';
import { modelOfTenant } from './model';
import { currencyEnum } from './tenants';
import { transactions } from './transactions';
import { users } from './users';

export const financeReceiptStatus = pgEnum('finance_receipt_status', [
  'submitted',
  'approved',
  'rejected',
  'refunded',
]);

export const financeReceiptUploadStatus = pgEnum(
  'finance_receipt_upload_status',
  ['pending', 'ready', 'rejected', 'consumed'],
);

export const financeReceiptUploads = pgTable(
  'finance_receipt_uploads',
  {
    ...modelOfTenant,
    consumedAt: timestamp(),
    eventId: varchar({ length: 20 })
      .notNull()
      .references(() => eventInstances.id),
    expiresAt: timestamp()
      .notNull()
      .default(sql`(now() + '00:05:00'::interval)`),
    fileName: text().notNull(),
    mimeType: text().notNull(),
    rejectionReason: text(),
    sizeBytes: integer().notNull(),
    status: financeReceiptUploadStatus().notNull().default('pending'),
    storageKey: text().notNull().unique(),
    storageUrl: text(),
    uploadedAt: timestamp(),
    uploadedByUserId: varchar({ length: 20 })
      .notNull()
      .references(() => users.id),
  },
  (table) => [
    unique('finance_receipt_upload_scope_unique').on(
      table.id,
      table.tenantId,
      table.eventId,
      table.uploadedByUserId,
    ),
  ],
);

export const financeReceipts = pgTable(
  'finance_receipts',
  {
    ...modelOfTenant,
    alcoholAmount: integer().notNull().default(0),
    attachmentFileName: text().notNull(),
    attachmentMimeType: text().notNull(),
    attachmentSizeBytes: integer().notNull(),
    attachmentUploadId: varchar({ length: 20 }).notNull(),
    currency: currencyEnum().notNull(),
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
    refundTransactionId: varchar({ length: 20 }).references(
      () => transactions.id,
    ),
    rejectionReason: text(),
    reviewedAt: timestamp(),
    reviewedByUserId: varchar({ length: 20 }).references(() => users.id),
    status: financeReceiptStatus().notNull().default('submitted'),
    stripeTaxRateId: varchar(),
    submittedByUserId: varchar({ length: 20 })
      .notNull()
      .references(() => users.id),
    taxAmount: integer().notNull().default(0),
    totalAmount: integer().notNull(),
  },
  (table) => [
    unique('finance_receipts_attachment_upload_unique').on(
      table.attachmentUploadId,
    ),
    foreignKey({
      columns: [
        table.attachmentUploadId,
        table.tenantId,
        table.eventId,
        table.submittedByUserId,
      ],
      foreignColumns: [
        financeReceiptUploads.id,
        financeReceiptUploads.tenantId,
        financeReceiptUploads.eventId,
        financeReceiptUploads.uploadedByUserId,
      ],
      name: 'finance_receipts_attachment_upload_scope_fk',
    }),
  ],
);
