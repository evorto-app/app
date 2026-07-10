import { describe, expect, it } from '@effect/vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { financeReceipts, financeReceiptUploads } from './finance-receipts';

describe('finance receipt schema', () => {
  it('binds each receipt to one scoped upload and snapshots its currency', () => {
    const receiptConfig = getTableConfig(financeReceipts);
    const uploadConfig = getTableConfig(financeReceiptUploads);
    const uploadScopeForeignKey = receiptConfig.foreignKeys.find(
      (foreignKey) =>
        foreignKey.getName() === 'finance_receipts_attachment_upload_scope_fk',
    );
    const attachmentUploadUnique = receiptConfig.uniqueConstraints.find(
      (constraint) =>
        constraint.getName() === 'finance_receipts_attachment_upload_unique',
    );
    const uploadScopeUnique = uploadConfig.uniqueConstraints.find(
      (constraint) =>
        constraint.getName() === 'finance_receipt_upload_scope_unique',
    );

    expect(
      receiptConfig.columns.find((column) => column.name === 'currency')
        ?.notNull,
    ).toBe(true);
    expect(
      receiptConfig.columns.find(
        (column) => column.name === 'attachmentUploadId',
      )?.notNull,
    ).toBe(true);
    expect(
      uploadScopeForeignKey?.reference().columns.map((column) => column.name),
    ).toEqual([
      'attachmentUploadId',
      'tenantId',
      'eventId',
      'submittedByUserId',
    ]);
    expect(
      uploadScopeForeignKey
        ?.reference()
        .foreignColumns.map((column) => column.name),
    ).toEqual(['id', 'tenantId', 'eventId', 'uploadedByUserId']);
    expect(uploadScopeForeignKey?.reference().foreignTable).toBe(
      financeReceiptUploads,
    );
    expect(
      attachmentUploadUnique?.columns.map((column) => column.name),
    ).toEqual(['attachmentUploadId']);
    expect(uploadScopeUnique?.columns.map((column) => column.name)).toEqual([
      'id',
      'tenantId',
      'eventId',
      'uploadedByUserId',
    ]);
  });
});
