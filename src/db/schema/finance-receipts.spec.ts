import { describe, expect, it } from '@effect/vitest';
import { is, SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import {
  financeReceiptAlcoholAmountConsistentCheckName,
  financeReceiptComponentsWithinTotalCheckName,
  financeReceiptDepositAmountConsistentCheckName,
  financeReceipts,
  financeReceiptTaxAmountValidCheckName,
  financeReceiptTotalAmountPositiveCheckName,
  financeReceiptUploads,
} from './finance-receipts';

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
    expect(
      uploadConfig.columns.find((column) => column.name === 'status')?.notNull,
    ).toBe(true);
    expect(
      uploadConfig.columns.find((column) => column.name === 'expiresAt')
        ?.notNull,
    ).toBe(true);

    const expiresAtDefault = uploadConfig.columns.find(
      (column) => column.name === 'expiresAt',
    )?.default;
    expect(is(expiresAtDefault, SQL)).toBe(true);
    if (!is(expiresAtDefault, SQL)) {
      throw new Error('Receipt upload expiry must use a SQL default');
    }
    expect(new PgDialect().sqlToQuery(expiresAtDefault).sql).toBe(
      `(now() + '00:05:00'::interval)`,
    );
  });

  it('stores calendar dates and requires explicit receipt amount fields', () => {
    const receiptConfig = getTableConfig(financeReceipts);
    const receiptDate = receiptConfig.columns.find(
      (column) => column.name === 'receiptDate',
    );

    expect(receiptDate?.getSQLType()).toBe('date');
    expect(receiptDate?.mapFromDriverValue('2026-07-09')).toBe('2026-07-09');

    for (const columnName of [
      'alcoholAmount',
      'depositAmount',
      'hasAlcohol',
      'hasDeposit',
      'taxAmount',
      'totalAmount',
    ]) {
      const column = receiptConfig.columns.find(
        (candidate) => candidate.name === columnName,
      );
      expect(column?.notNull).toBe(true);
      expect(column?.hasDefault).toBe(false);
    }
  });

  it('enforces receipt totals and optional amount consistency in PostgreSQL', () => {
    const receiptConfig = getTableConfig(financeReceipts);
    const checkSql = (name: string): string => {
      const constraint = receiptConfig.checks.find(
        (candidate) => candidate.name === name,
      );
      expect(constraint).toBeDefined();
      if (!constraint) {
        throw new Error(`Expected receipt check constraint ${name}`);
      }
      return new PgDialect().sqlToQuery(constraint.value).sql;
    };

    expect(checkSql(financeReceiptTotalAmountPositiveCheckName)).toContain(
      '"totalAmount" > 0',
    );
    expect(checkSql(financeReceiptTaxAmountValidCheckName)).toContain(
      '"taxAmount" <= "finance_receipts"."totalAmount"',
    );
    expect(checkSql(financeReceiptDepositAmountConsistentCheckName)).toContain(
      '"hasDeposit"',
    );
    expect(checkSql(financeReceiptAlcoholAmountConsistentCheckName)).toContain(
      '"hasAlcohol"',
    );
    expect(checkSql(financeReceiptComponentsWithinTotalCheckName)).toContain(
      'AS bigint',
    );
  });
});
