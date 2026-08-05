import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { maximumFinanceReimbursementReceiptCount } from '../../finance/reimbursement';
import {
  FinanceReceiptAttachmentInput,
  FinanceReceiptCreateRefundInput,
  FinanceReceiptFieldsInput,
  FinanceReceiptRefundGroupRecord,
  FinanceTransactionPageInput,
} from './finance.rpcs';

const makeReceiptIds = (count: number): string[] =>
  Array.from({ length: count }, (_, index) => `receipt-${index + 1}`);

describe('FinanceReceiptAttachmentInput', () => {
  it('accepts only a server-issued upload reference and display name', () => {
    expect(
      Schema.decodeUnknownSync(FinanceReceiptAttachmentInput)({
        fileName: 'Train ticket',
        uploadId: 'upload-1',
      }),
    ).toEqual({
      fileName: 'Train ticket',
      uploadId: 'upload-1',
    });
  });

  it('does not carry caller-supplied object storage metadata', () => {
    const decoded = Schema.decodeUnknownSync(FinanceReceiptAttachmentInput)({
      fileName: 'Train ticket',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
      storageKey: 'receipts/another-tenant/secret.pdf',
      storageUrl: 'https://storage.example/secret.pdf',
      uploadId: 'upload-1',
    });

    expect(decoded).toEqual({
      fileName: 'Train ticket',
      uploadId: 'upload-1',
    });
  });
});

describe('FinanceReceiptFieldsInput', () => {
  const validFields = {
    alcoholAmount: 0,
    depositAmount: 0,
    hasAlcohol: false,
    hasDeposit: false,
    purchaseCountry: 'DE',
    receiptDate: '2026-07-09',
    taxAmount: 0,
    totalAmount: 100,
  };

  it('accepts exact bounded minor units and a calendar date', () => {
    expect(
      Schema.decodeUnknownSync(FinanceReceiptFieldsInput)(validFields),
    ).toEqual(validFields);
  });

  it.each([
    { totalAmount: 0 },
    { totalAmount: 100.5 },
    { taxAmount: 0.5 },
    { depositAmount: 0.5, hasDeposit: true },
    { alcoholAmount: 0.5, hasAlcohol: true },
    { depositAmount: 1, hasDeposit: false },
    { depositAmount: 0, hasDeposit: true },
    { receiptDate: '09.07.2026' },
    { receiptDate: '2026-7-09' },
    { receiptDate: '2026-07-09 ' },
    { receiptDate: '2026-07-09T00:00:00.000Z' },
    { receiptDate: '2026-02-30' },
  ])('rejects invalid receipt fields %#', (override) => {
    expect(() =>
      Schema.decodeUnknownSync(FinanceReceiptFieldsInput)({
        ...validFields,
        ...override,
      }),
    ).toThrow();
  });
});

describe('FinanceReceiptCreateRefundInput', () => {
  it.each([
    {
      payoutReference: 'DE89370400440532013000',
      payoutType: 'iban',
      receiptIds: ['receipt-1'],
    },
    {
      payoutReference: 'participant@example.test',
      payoutType: 'paypal',
      receiptIds: ['receipt-1'],
    },
  ] as const)('accepts a canonical $payoutType destination', (input) => {
    expect(
      Schema.decodeUnknownSync(FinanceReceiptCreateRefundInput)(input),
    ).toEqual(input);
  });

  it.each([
    {
      payoutReference: 'DE89 3704 0044 0532 0130 00',
      payoutType: 'iban',
      receiptIds: ['receipt-1'],
    },
    {
      payoutReference: 'Participant@Example.Test',
      payoutType: 'paypal',
      receiptIds: ['receipt-1'],
    },
    {
      payoutReference: 'participant@example.test',
      payoutType: 'iban',
      receiptIds: ['receipt-1'],
    },
  ])('rejects non-canonical or mismatched payout input %#', (input) => {
    expect(() =>
      Schema.decodeUnknownSync(FinanceReceiptCreateRefundInput)(input),
    ).toThrow();
  });

  it.each([
    {
      payoutReference: 'DE89370400440532013000',
      payoutType: 'iban',
    },
    {
      payoutReference: 'participant@example.test',
      payoutType: 'paypal',
    },
  ] as const)(
    'accepts no more than 100 receipts for a $payoutType reimbursement',
    ({ payoutReference, payoutType }) => {
      const maximumBatch = {
        payoutReference,
        payoutType,
        receiptIds: makeReceiptIds(maximumFinanceReimbursementReceiptCount),
      };

      expect(
        Schema.decodeUnknownSync(FinanceReceiptCreateRefundInput)(maximumBatch),
      ).toEqual(maximumBatch);
      expect(() =>
        Schema.decodeUnknownSync(FinanceReceiptCreateRefundInput)({
          ...maximumBatch,
          receiptIds: makeReceiptIds(
            maximumFinanceReimbursementReceiptCount + 1,
          ),
        }),
      ).toThrow();
    },
  );

  it('rejects non-canonical persisted payout destinations', () => {
    expect(() =>
      Schema.decodeUnknownSync(FinanceReceiptRefundGroupRecord)({
        currency: 'EUR',
        payout: {
          iban: 'DE89 3704 0044 0532 0130 00',
          paypalEmail: null,
        },
        receipts: [],
        submittedByEmail: 'participant@example.test',
        submittedByFirstName: 'Pat',
        submittedByLastName: 'Example',
        submittedByUserId: 'user-1',
        totalAmount: 0,
      }),
    ).toThrow();
  });
});

describe('FinanceTransactionPageInput', () => {
  it('accepts a bounded positive page size and non-negative integer offset', () => {
    expect(
      Schema.decodeUnknownSync(FinanceTransactionPageInput)({
        limit: 100,
        offset: 0,
      }),
    ).toEqual({ limit: 100, offset: 0 });
  });

  it.each([
    { limit: 0, offset: 0 },
    { limit: 101, offset: 0 },
    { limit: 10.5, offset: 0 },
    { limit: 10, offset: -1 },
    { limit: 10, offset: 0.5 },
  ])('rejects invalid paging %#', (input) => {
    expect(() =>
      Schema.decodeUnknownSync(FinanceTransactionPageInput)(input),
    ).toThrow();
  });
});
