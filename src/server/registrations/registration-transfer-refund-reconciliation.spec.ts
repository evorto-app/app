import { describe, expect, it } from 'vitest';

import { registrationTransferSourceRefundAggregate } from './registration-transfer-refund-reconciliation';

const sourceRefund = (
  overrides: Partial<
    Parameters<typeof registrationTransferSourceRefundAggregate>[0][number]
  > = {},
) => ({
  refundAmountDue: 1000,
  refundTransactionId: 'refund-1',
  status: 'pending' as const,
  stripeRefundStatus: 'pending' as const,
  ...overrides,
});

describe('registrationTransferSourceRefundAggregate', () => {
  it('succeeds only after every positive refund item succeeds', () => {
    expect(
      registrationTransferSourceRefundAggregate([
        sourceRefund({ refundAmountDue: 0, refundTransactionId: null }),
        sourceRefund({
          status: 'successful',
          stripeRefundStatus: 'succeeded',
        }),
        sourceRefund({
          refundTransactionId: 'refund-2',
          status: 'successful',
          stripeRefundStatus: 'succeeded',
        }),
      ]),
    ).toBe('succeeded');
  });

  it('stays pending while any sibling claim is unfinished', () => {
    expect(
      registrationTransferSourceRefundAggregate([
        sourceRefund({
          status: 'successful',
          stripeRefundStatus: 'succeeded',
        }),
        sourceRefund({ refundTransactionId: 'refund-2' }),
      ]),
    ).toBe('pending');
  });

  it.each([
    { status: 'successful' as const, stripeRefundStatus: 'pending' as const },
    { status: 'pending' as const, stripeRefundStatus: 'succeeded' as const },
  ])(
    'does not complete for inconsistent success state %#',
    ({ status, stripeRefundStatus }) => {
      expect(
        registrationTransferSourceRefundAggregate([
          sourceRefund({ status, stripeRefundStatus }),
        ]),
      ).toBe('pending');
    },
  );

  it.each([
    sourceRefund({ refundTransactionId: null, status: null }),
    sourceRefund({ status: 'cancelled' }),
    sourceRefund({ stripeRefundStatus: 'canceled' }),
    sourceRefund({ stripeRefundStatus: 'failed' }),
  ])('fails closed for a missing or terminal sibling claim', (item) => {
    expect(
      registrationTransferSourceRefundAggregate([
        sourceRefund({
          status: 'successful',
          stripeRefundStatus: 'succeeded',
        }),
        item,
      ]),
    ).toBe('failed');
  });
});
