import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  PlatformFinanceReceiptRecord,
  PlatformFinanceReceiptReviewInput,
  PlatformFinanceRecordReimbursementInput,
  PlatformFinanceRefundRecoveryRecord,
  PlatformFinanceRequeueRefundClaimInput,
  PlatformFinanceTenantContext,
} from './platform-tenant-finance.rpcs';

describe('platform tenant finance RPC schemas', () => {
  it('requires an explicit target tenant and reason for receipt reviews', () => {
    const input = {
      alcoholAmount: 0,
      depositAmount: 0,
      hasAlcohol: false,
      hasDeposit: false,
      id: 'receipt-1',
      purchaseCountry: 'DE',
      reason: 'Review a production receipt on behalf of the tenant',
      receiptDate: '2026-07-10T00:00:00.000Z',
      status: 'approved' as const,
      targetTenantId: 'tenant-1',
      taxAmount: 100,
      totalAmount: 1000,
    };

    expect(
      Schema.decodeUnknownSync(PlatformFinanceReceiptReviewInput)(input),
    ).toEqual(input);
    expect(() =>
      Schema.decodeUnknownSync(PlatformFinanceReceiptReviewInput)({
        ...input,
        targetTenantId: '',
      }),
    ).toThrow();
  });

  it('accepts only payout type and strips client payout references', () => {
    const decoded = Schema.decodeUnknownSync(
      PlatformFinanceRecordReimbursementInput,
    )({
      payoutReference: 'DE89 3704 0044 0532 0130 00',
      payoutType: 'iban',
      payoutVersion: 'opaque-version',
      reason: 'Record the completed external bank transfer',
      receiptIds: ['receipt-1'],
      targetTenantId: 'tenant-1',
    });

    expect(decoded).toEqual({
      payoutType: 'iban',
      payoutVersion: 'opaque-version',
      reason: 'Record the completed external bank transfer',
      receiptIds: ['receipt-1'],
      targetTenantId: 'tenant-1',
    });
    expect(decoded).not.toHaveProperty('payoutReference');
    expect(() =>
      Schema.decodeUnknownSync(PlatformFinanceRecordReimbursementInput)({
        payoutType: 'iban',
        payoutVersion: 'opaque-version',
        reason: 'Record one bounded reimbursement batch',
        receiptIds: Array.from(
          { length: 101 },
          (_, index) => `receipt-${index}`,
        ),
        targetTenantId: 'tenant-1',
      }),
    ).toThrow();
  });

  it('requires whole minor units for platform receipt decisions', () => {
    expect(() =>
      Schema.decodeUnknownSync(PlatformFinanceReceiptReviewInput)({
        alcoholAmount: 0,
        depositAmount: 0,
        hasAlcohol: false,
        hasDeposit: false,
        id: 'receipt-1',
        purchaseCountry: 'DE',
        reason: 'Review the receipt',
        receiptDate: '2026-07-10',
        status: 'approved',
        targetTenantId: 'tenant-1',
        taxAmount: 0.5,
        totalAmount: 1000,
      }),
    ).toThrow();
  });

  it('models only explicit eligible refund recovery and requires a reason to requeue', () => {
    expect(
      Schema.decodeUnknownSync(PlatformFinanceRefundRecoveryRecord)({
        amount: 1200,
        createdAt: '2026-07-10T10:00:00.000Z',
        currency: 'EUR',
        eventId: 'event-1',
        eventRegistrationId: 'registration-1',
        id: 'refund-claim-1',
        lastError: 'Stripe refund reached terminal status failed',
        mode: 'newGeneration',
        sourceTransactionId: 'source-transaction-1',
        stripeRefundAttempts: 1,
        stripeRefundGeneration: 0,
        stripeRefundMaxAttempts: 8,
        stripeRefundStatus: 'failed',
        transfer: null,
        updatedAt: '2026-07-10T10:05:00.000Z',
      }),
    ).toMatchObject({ id: 'refund-claim-1', mode: 'newGeneration' });

    expect(
      Schema.decodeUnknownSync(PlatformFinanceRequeueRefundClaimInput)({
        reason: 'Retry after verifying the terminal Stripe state',
        refundClaimId: 'refund-claim-1',
        targetTenantId: 'tenant-1',
      }),
    ).toMatchObject({
      refundClaimId: 'refund-claim-1',
      targetTenantId: 'tenant-1',
    });
  });

  it('returns target currency and receipt-country configuration explicitly', () => {
    expect(
      Schema.decodeUnknownSync(PlatformFinanceTenantContext)({
        currency: 'CZK',
        receiptCountryConfig: {
          allowOther: true,
          receiptCountries: ['CZ', 'DE'],
        },
        targetTenantId: 'tenant-1',
      }),
    ).toMatchObject({
      currency: 'CZK',
      receiptCountryConfig: {
        allowOther: true,
        receiptCountries: ['CZ', 'DE'],
      },
    });
  });

  it('keeps receipt storage keys outside the platform response', () => {
    const decoded = Schema.decodeUnknownSync(PlatformFinanceReceiptRecord)({
      alcoholAmount: 0,
      attachmentFileName: 'receipt.pdf',
      attachmentMimeType: 'application/pdf',
      attachmentStorageKey: 'receipts/tenant-1/private.pdf',
      createdAt: '2026-07-10T10:00:00.000Z',
      currency: 'AUD',
      depositAmount: 0,
      eventId: 'event-1',
      hasAlcohol: false,
      hasDeposit: false,
      id: 'receipt-1',
      previewImageUrl: 'https://signed.example.org/receipt',
      purchaseCountry: 'DE',
      receiptDate: '2026-07-09T00:00:00.000Z',
      refundedAt: null,
      refundTransactionId: null,
      rejectionReason: null,
      reviewedAt: null,
      status: 'submitted',
      submittedByUserId: 'user-1',
      taxAmount: 100,
      totalAmount: 1000,
      updatedAt: '2026-07-10T10:00:00.000Z',
    });

    expect(decoded).not.toHaveProperty('attachmentStorageKey');
    expect(decoded.currency).toBe('AUD');
    expect(decoded.previewImageUrl).toBe('https://signed.example.org/receipt');
  });
});
