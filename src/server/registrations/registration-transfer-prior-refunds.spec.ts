import { describe, expect, it } from 'vitest';

import { resolveRegistrationTransferPriorRefunds } from './registration-transfer-prior-refunds';

const sourcePayment = {
  amount: 1200,
  currency: 'EUR',
  eventId: 'event-1',
  eventRegistrationId: 'registration-1',
  id: 'payment-1',
  stripeAccountId: 'acct_1',
  targetUserId: 'source-user-1',
} as const;

const priorRefund = {
  amount: -400,
  currency: 'EUR',
  eventId: 'event-1',
  eventRegistrationId: 'registration-1',
  manuallyCreated: false,
  method: 'stripe',
  sourceTransactionId: 'payment-1',
  status: 'successful',
  stripeAccountId: 'acct_1',
  stripeRefundId: 're_1',
  stripeRefundStatus: 'succeeded',
  targetUserId: 'source-user-1',
} as const;

describe('registration transfer prior refunds', () => {
  it('adds exact completed refunds independently for every source payment', () => {
    const resolution = resolveRegistrationTransferPriorRefunds({
      refunds: [
        priorRefund,
        { ...priorRefund, amount: -300 },
        {
          ...priorRefund,
          amount: -200,
          sourceTransactionId: 'payment-2',
        },
      ],
      sourcePayments: [
        sourcePayment,
        { ...sourcePayment, amount: 500, id: 'payment-2' },
      ],
    });

    expect(resolution._tag).toBe('Valid');
    if (resolution._tag !== 'Valid') return;
    expect(
      Object.fromEntries(resolution.refundedBySourceTransactionId),
    ).toEqual({ 'payment-1': 700, 'payment-2': 200 });
  });

  it('counts provider-observed successes and ignores provider refunds that never completed', () => {
    const resolution = resolveRegistrationTransferPriorRefunds({
      refunds: [
        { ...priorRefund, amount: -400, stripeRefundId: 're_provider' },
        {
          ...priorRefund,
          amount: -300,
          status: 'cancelled',
          stripeRefundId: 're_failed',
          stripeRefundStatus: 'failed',
        },
      ],
      sourcePayments: [sourcePayment],
    });

    expect(resolution._tag).toBe('Valid');
    if (resolution._tag !== 'Valid') return;
    expect(resolution.refundedBySourceTransactionId.get('payment-1')).toBe(400);
  });

  it.each([
    ['currency', { currency: 'USD' }],
    ['event', { eventId: 'event-2' }],
    ['registration', { eventRegistrationId: 'registration-2' }],
    ['manual origin', { manuallyCreated: true }],
    ['missing automatic origin', { manuallyCreated: null }],
    ['Stripe account', { stripeAccountId: 'acct_2' }],
    ['missing Stripe refund identity', { stripeRefundId: null }],
    ['blank Stripe refund identity', { stripeRefundId: '  ' }],
    ['target user', { targetUserId: 'other-user' }],
    ['source transaction', { sourceTransactionId: 'payment-2' }],
  ])('rejects mismatched %s provenance', (_label, override) => {
    expect(
      resolveRegistrationTransferPriorRefunds({
        refunds: [{ ...priorRefund, ...override }],
        sourcePayments: [sourcePayment],
      }),
    ).toEqual({ _tag: 'InvalidProvenance' });
  });

  it.each([
    { status: 'pending' },
    { stripeRefundStatus: 'pending' },
    { method: 'cash' },
  ])('rejects an unresolved refund state %#', (override) => {
    expect(
      resolveRegistrationTransferPriorRefunds({
        refunds: [{ ...priorRefund, ...override }],
        sourcePayments: [sourcePayment],
      }),
    ).toEqual({ _tag: 'Unresolved' });
  });

  it('rejects invalid and excessive refund arithmetic', () => {
    expect(
      resolveRegistrationTransferPriorRefunds({
        refunds: [{ ...priorRefund, amount: 0 }],
        sourcePayments: [sourcePayment],
      }),
    ).toEqual({ _tag: 'InvalidAmount' });
    expect(
      resolveRegistrationTransferPriorRefunds({
        refunds: [priorRefund, { ...priorRefund, amount: -900 }],
        sourcePayments: [sourcePayment],
      }),
    ).toEqual({ _tag: 'InvalidAmount' });
  });
});
