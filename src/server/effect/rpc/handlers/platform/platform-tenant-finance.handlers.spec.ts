import { describe, expect, it } from '@effect/vitest';
import {
  PlatformFinanceReceiptApprovalDetail,
  PlatformFinanceReceiptApprovalDetailRecord,
  PlatformFinanceReceiptApprovalGroup,
  PlatformFinanceReceiptApprovalQueue,
  PlatformFinanceReceiptWithSubmitterRecord,
  PlatformFinanceRefundRecoveryQueue,
  PlatformFinanceReimbursementGroup,
  PlatformFinanceReimbursementQueue,
  PlatformFinanceReimbursementReceipt,
  PlatformFinanceTenantContext,
} from '@shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';
import { Effect, Schema } from 'effect';
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
  toRefundRecoveryRecord,
} from './platform-tenant-finance.handlers';

const receiptWithSubmitterInput = (
  status: 'approved' | 'submitted',
): Parameters<typeof PlatformFinanceReceiptWithSubmitterRecord.make>[0] => ({
  alcoholAmount: 0,
  attachmentFileName: 'receipt.pdf',
  attachmentMimeType: 'application/pdf',
  createdAt: '2026-07-10T10:00:00.000Z',
  currency: 'EUR',
  depositAmount: 0,
  eventId: 'event-1',
  hasAlcohol: false,
  hasDeposit: false,
  id: 'receipt-1',
  previewImageUrl: 'https://example.test/receipt.pdf',
  purchaseCountry: 'DE',
  receiptDate: '2026-07-09',
  refundedAt: null,
  refundTransactionId: null,
  rejectionReason: null,
  reviewedAt: null,
  status,
  submittedByEmail: 'participant@example.test',
  submittedByFirstName: 'Pat',
  submittedByLastName: 'Example',
  submittedByUserId: 'user-1',
  taxAmount: 190,
  totalAmount: 1190,
  updatedAt: '2026-07-10T10:00:00.000Z',
});

const tenantContext = () =>
  PlatformFinanceTenantContext.make({
    currency: 'EUR',
    receiptCountryConfig: { allowOther: false, receiptCountries: ['DE'] },
    targetTenantId: 'tenant-1',
  });

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

  it('constructs every nested finance RPC class at its handler boundary', () => {
    const source = readFileSync(
      new URL('platform-tenant-finance.handlers.ts', import.meta.url),
      'utf8',
    );

    for (const constructor of [
      'PlatformFinanceReceiptApprovalDetailRecord.make',
      'PlatformFinanceReceiptApprovalGroup.make',
      'PlatformFinanceReceiptWithSubmitterRecord.make',
      'PlatformFinanceReimbursementGroup.make',
      'PlatformFinanceReimbursementReceipt.make',
    ]) {
      expect(source).toContain(constructor);
    }
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

  it('encodes recovery queue records through the RPC success schema', () => {
    const recovery = toRefundRecoveryRecord({
      amount: -1800,
      attempts: 8,
      createdAt: new Date('2026-07-10T10:00:00.000Z'),
      currency: 'EUR',
      eventId: 'event-1',
      eventRegistrationId: 'source-registration-1',
      generation: 0,
      lastError: 'Terminal Stripe refund failure',
      leaseExpiresAt: null,
      leaseId: null,
      maxAttempts: 8,
      nextAttemptAt: null,
      refundClaimId: 'refund-claim-1',
      refundId: 're_failed',
      sourceTransactionId: 'source-transaction-1',
      status: 'pending',
      stripeRefundStatus: 'failed',
      transferEventId: 'event-1',
      transferId: 'transfer-1',
      transferRecipientRegistrationId: 'recipient-registration-1',
      transferSourceRegistrationId: 'source-registration-1',
      transferStatus: 'refund_failed',
      updatedAt: new Date('2026-07-10T11:00:00.000Z'),
    });
    if (!recovery) {
      throw new Error('Expected an eligible refund recovery record');
    }

    expect(
      Schema.encodeUnknownSync(
        PlatformFinanceRefundRecoveryQueue.successSchema,
      )({
        claims: [recovery],
        tenantContext: PlatformFinanceTenantContext.make({
          currency: 'EUR',
          receiptCountryConfig: { allowOther: false, receiptCountries: [] },
          targetTenantId: 'tenant-1',
        }),
      }),
    ).toEqual({
      claims: [
        {
          amount: 1800,
          createdAt: '2026-07-10T10:00:00.000Z',
          currency: 'EUR',
          eventId: 'event-1',
          eventRegistrationId: 'source-registration-1',
          id: 'refund-claim-1',
          lastError: 'Terminal Stripe refund failure',
          mode: 'newGeneration',
          sourceTransactionId: 'source-transaction-1',
          stripeRefundAttempts: 8,
          stripeRefundGeneration: 0,
          stripeRefundMaxAttempts: 8,
          stripeRefundStatus: 'failed',
          transfer: {
            eventId: 'event-1',
            id: 'transfer-1',
            recipientRegistrationId: 'recipient-registration-1',
            sourceRegistrationId: 'source-registration-1',
            status: 'refund_failed',
          },
          updatedAt: '2026-07-10T11:00:00.000Z',
        },
      ],
      tenantContext: {
        currency: 'EUR',
        receiptCountryConfig: { allowOther: false, receiptCountries: [] },
        targetTenantId: 'tenant-1',
      },
    });
  });

  it('encodes an approval detail record through the RPC success schema', () => {
    const receipt = PlatformFinanceReceiptApprovalDetailRecord.make({
      ...receiptWithSubmitterInput('submitted'),
      eventStart: '2026-07-20T10:00:00.000Z',
      eventTitle: 'Welcome event',
    });

    expect(
      Schema.encodeUnknownSync(
        PlatformFinanceReceiptApprovalDetail.successSchema,
      )({ receipt, tenantContext: tenantContext() }),
    ).toMatchObject({
      receipt: {
        eventTitle: 'Welcome event',
        id: 'receipt-1',
        status: 'submitted',
      },
      tenantContext: { targetTenantId: 'tenant-1' },
    });
  });

  it('encodes approval queue groups and receipts through the RPC success schema', () => {
    const receipt = PlatformFinanceReceiptWithSubmitterRecord.make(
      receiptWithSubmitterInput('submitted'),
    );
    const group = PlatformFinanceReceiptApprovalGroup.make({
      eventId: 'event-1',
      eventStart: '2026-07-20T10:00:00.000Z',
      eventTitle: 'Welcome event',
      receipts: [receipt],
    });

    expect(
      Schema.encodeUnknownSync(
        PlatformFinanceReceiptApprovalQueue.successSchema,
      )({ groups: [group], tenantContext: tenantContext() }),
    ).toMatchObject({
      groups: [
        {
          eventId: 'event-1',
          receipts: [{ id: 'receipt-1', status: 'submitted' }],
        },
      ],
      tenantContext: { targetTenantId: 'tenant-1' },
    });
  });

  it('encodes reimbursement groups and receipts through the RPC success schema', () => {
    const receipt = PlatformFinanceReimbursementReceipt.make({
      ...receiptWithSubmitterInput('approved'),
      eventStart: '2026-07-20T10:00:00.000Z',
      eventTitle: 'Welcome event',
    });
    const group = PlatformFinanceReimbursementGroup.make({
      currency: 'EUR',
      payout: { iban: 'DE89370400440532013000', paypalEmail: null },
      payoutVersions: { iban: 'payout-version-1', paypal: null },
      receipts: [receipt],
      submittedByEmail: 'participant@example.test',
      submittedByFirstName: 'Pat',
      submittedByLastName: 'Example',
      submittedByUserId: 'user-1',
      totalAmount: 1190,
    });

    expect(
      Schema.encodeUnknownSync(PlatformFinanceReimbursementQueue.successSchema)(
        { groups: [group], tenantContext: tenantContext() },
      ),
    ).toMatchObject({
      groups: [
        {
          currency: 'EUR',
          receipts: [{ id: 'receipt-1', status: 'approved' }],
          submittedByUserId: 'user-1',
        },
      ],
      tenantContext: { targetTenantId: 'tenant-1' },
    });
  });
});
