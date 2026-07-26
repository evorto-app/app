import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
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

export const financeReceiptTotalAmountPositiveCheckName =
  'finance_receipts_total_amount_positive';
export const financeReceiptTaxAmountValidCheckName =
  'finance_receipts_tax_amount_valid';
export const financeReceiptDepositAmountConsistentCheckName =
  'finance_receipts_deposit_amount_consistent';
export const financeReceiptAlcoholAmountConsistentCheckName =
  'finance_receipts_alcohol_amount_consistent';
export const financeReceiptComponentsWithinTotalCheckName =
  'finance_receipts_components_within_total';

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
    alcoholAmount: integer().notNull(),
    attachmentFileName: text().notNull(),
    attachmentMimeType: text().notNull(),
    attachmentSizeBytes: integer().notNull(),
    attachmentUploadId: varchar({ length: 20 }).notNull(),
    currency: currencyEnum().notNull(),
    depositAmount: integer().notNull(),
    eventId: varchar({ length: 20 })
      .notNull()
      .references(() => eventInstances.id),
    hasAlcohol: boolean().notNull(),
    hasDeposit: boolean().notNull(),
    previewImageId: text(),
    previewImageUrl: text(),
    purchaseCountry: text().notNull(),
    receiptDate: date().notNull(),
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
    taxAmount: integer().notNull(),
    totalAmount: integer().notNull(),
  },
  (table) => [
    check(
      financeReceiptTotalAmountPositiveCheckName,
      sql`${table.totalAmount} > 0`,
    ),
    check(
      financeReceiptTaxAmountValidCheckName,
      sql`${table.taxAmount} >= 0 AND ${table.taxAmount} <= ${table.totalAmount}`,
    ),
    check(
      financeReceiptDepositAmountConsistentCheckName,
      sql`(${table.hasDeposit} AND ${table.depositAmount} > 0 AND ${table.depositAmount} <= ${table.totalAmount}) OR (NOT ${table.hasDeposit} AND ${table.depositAmount} = 0)`,
    ),
    check(
      financeReceiptAlcoholAmountConsistentCheckName,
      sql`(${table.hasAlcohol} AND ${table.alcoholAmount} > 0 AND ${table.alcoholAmount} <= ${table.totalAmount}) OR (NOT ${table.hasAlcohol} AND ${table.alcoholAmount} = 0)`,
    ),
    check(
      financeReceiptComponentsWithinTotalCheckName,
      sql`CAST(${table.depositAmount} AS bigint) + CAST(${table.alcoholAmount} AS bigint) <= ${table.totalAmount}`,
    ),
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
