import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import { readFileSync } from 'node:fs';

import {
  canPlatformReviewReceipt,
  payoutDetailsVersion,
  platformReceiptReviewUpdate,
  platformReimbursementReceiptUpdate,
  platformReimbursementTransactionInsert,
  platformTenantFinanceHandlers,
  refundRecoveryAuditSnapshot,
  reimbursementAuditSnapshot,
  resolvePlatformReimbursementCurrency,
} from './platform-tenant-finance.handlers';

describe('platform tenant finance handlers', () => {
  it('exports only the dedicated target-scoped finance methods', () => {
    expect(Object.keys(platformTenantFinanceHandlers).toSorted()).toEqual([
      'platform.finance.receipts.approvalDetail',
      'platform.finance.receipts.approvalQueue',
      'platform.finance.receipts.recordReimbursement',
      'platform.finance.receipts.reimbursementQueue',
      'platform.finance.receipts.review',
      'platform.finance.refundClaims.recoveryQueue',
      'platform.finance.refundClaims.requeue',
      'platform.finance.transactions.findMany',
    ]);
  });

  it('joins the scoped upload for every platform receipt media read', () => {
    const source = readFileSync(
      new URL('platform-tenant-finance.handlers.ts', import.meta.url),
      'utf8',
    );

    const scopedUploadJoinCount =
      source.split(
        '.innerJoin(financeReceiptUploads, financeReceiptUploadJoin)',
      ).length - 1;

    expect(scopedUploadJoinCount).toBe(3);
  });

  it('versions payout details without sending them back in a mutation or audit', () => {
    const first = payoutDetailsVersion('iban', 'DE89 3704 0044');
    const sameNormalized = payoutDetailsVersion('iban', ' DE89 3704 0044 ');
    const changed = payoutDetailsVersion('iban', 'DE89 3704 0045');

    expect(first).toBe(sameNormalized);
    expect(first).not.toBe(changed);
    expect(first).toMatch(/^[a-f\d]{64}$/u);
  });

  it('allows only a newly submitted receipt to be reviewed', () => {
    expect(canPlatformReviewReceipt('submitted')).toBe(true);
    expect(canPlatformReviewReceipt('approved')).toBe(false);
    expect(canPlatformReviewReceipt('rejected')).toBe(false);
    expect(canPlatformReviewReceipt('refunded')).toBe(false);
  });

  it('leaves tenant-user reviewer and reimbursement actor foreign keys null', () => {
    const reviewedAt = new Date('2026-07-10T10:00:00.000Z');
    expect(
      platformReceiptReviewUpdate({
        alcoholAmount: 0,
        depositAmount: 0,
        hasAlcohol: false,
        hasDeposit: false,
        purchaseCountry: 'DE',
        receiptDate: new Date('2026-07-09T00:00:00.000Z'),
        rejectionReason: null,
        reviewedAt,
        status: 'approved',
        taxAmount: 100,
        totalAmount: 1000,
      }).reviewedByUserId,
    ).toBeNull();

    const transaction = platformReimbursementTransactionInsert({
      currency: 'CZK',
      eventCount: 1,
      eventId: 'event-1',
      payoutType: 'iban',
      receiptCount: 1,
      targetTenantId: 'tenant-1',
      targetUserId: 'user-1',
      totalAmount: 1000,
    });
    expect(transaction.executiveUserId).toBeNull();
    expect(transaction.currency).toBe('CZK');
    expect(transaction).not.toHaveProperty('payoutReference');

    expect(
      platformReimbursementReceiptUpdate({
        refundedAt: reviewedAt,
        transactionId: 'transaction-1',
      }).refundedByUserId,
    ).toBeNull();
  });

  it('creates a typed reimbursement audit envelope without payout or participant PII', () => {
    const snapshot = reimbursementAuditSnapshot({
      currency: 'EUR',
      payoutType: 'paypal',
      receiptIds: ['receipt-1', 'receipt-2'],
      refundedAt: new Date('2026-07-10T10:00:00.000Z'),
      status: 'refunded',
      totalAmount: 2000,
      transactionId: 'transaction-1',
    });

    expect(snapshot).toEqual({
      resourceId: 'receipt-1',
      resourceType: 'receipt',
      state: {
        currency: 'EUR',
        payoutType: 'paypal',
        receiptCount: 2,
        receiptIds: ['receipt-1', 'receipt-2'],
        refundedAt: '2026-07-10T10:00:00.000Z',
        status: 'refunded',
        totalAmount: 2000,
        transactionId: 'transaction-1',
      },
    });

    const encoded = JSON.stringify(snapshot);
    for (const forbiddenField of [
      'email',
      'iban',
      'paypalEmail',
      'payoutReference',
      'previewImageUrl',
      'storageKey',
    ]) {
      expect(encoded).not.toContain(forbiddenField);
    }
  });

  it.effect('accepts only one recorded currency per reimbursement batch', () =>
    Effect.gen(function* () {
      expect(
        yield* resolvePlatformReimbursementCurrency([
          { currency: 'CZK' },
          { currency: 'CZK' },
        ]),
      ).toBe('CZK');

      const error = yield* resolvePlatformReimbursementCurrency([
        { currency: 'EUR' },
        { currency: 'AUD' },
      ]).pipe(Effect.flip);
      expect(error['_tag']).toBe('RpcBadRequestError');
      expect(error.reason).toBe('mismatchedReceiptCurrency');
    }),
  );

  it('audits refund recovery mode and state without error text or Stripe identifiers', () => {
    const snapshot = refundRecoveryAuditSnapshot({
      amount: 1200,
      currency: 'EUR',
      eventId: 'event-1',
      eventRegistrationId: 'registration-1',
      hasLastError: true,
      maxAttempts: 8,
      mode: 'newGeneration',
      refundClaimId: 'refund-claim-1',
      sourceTransactionId: 'source-transaction-1',
      state: {
        attempts: 8,
        generation: 0,
        refundId: 're_secret',
        status: 'pending',
        stripeRefundStatus: 'failed',
      },
      transferId: 'transfer-1',
      transferStatus: 'refund_failed',
    });

    expect(snapshot).toMatchObject({
      resourceId: 'refund-claim-1',
      resourceType: 'refundClaim',
      state: {
        hasLastError: true,
        hasRefundId: true,
        mode: 'newGeneration',
        transferStatus: 'refund_failed',
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain('re_secret');
    expect(snapshot.state).not.toHaveProperty('lastError');

    const compensationSnapshot = refundRecoveryAuditSnapshot({
      amount: 1200,
      currency: 'EUR',
      eventId: 'event-1',
      eventRegistrationId: 'recipient-registration-1',
      hasLastError: true,
      maxAttempts: 8,
      mode: 'newGeneration',
      refundClaimId: 'compensation-claim-1',
      sourceTransactionId: 'recipient-payment-1',
      state: {
        attempts: 1,
        generation: 0,
        refundId: 're_compensation',
        status: 'pending',
        stripeRefundStatus: 'failed',
      },
      transferId: 'transfer-1',
      transferStatus: 'compensation_failed',
    });
    expect(compensationSnapshot.state).toMatchObject({
      transferStatus: 'compensation_failed',
    });
  });
});
