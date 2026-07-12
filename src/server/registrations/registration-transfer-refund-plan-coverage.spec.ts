import { describe, expect, it } from 'vitest';

import { refundPlansExactlyCoverCurrentAcquisitionPayments } from './registration-transfer-refund-plan-coverage';

const currentPayments = [
  { id: 'acquisition-payment-1', transactionId: 'transaction-1' },
  { id: 'acquisition-payment-2', transactionId: 'transaction-2' },
] as const;

const completePlans = [
  {
    sourceAcquisitionId: 'acquisition-1',
    sourceAcquisitionPaymentId: 'acquisition-payment-1',
    sourceTransactionId: 'transaction-1',
  },
  {
    sourceAcquisitionId: 'acquisition-1',
    sourceAcquisitionPaymentId: 'acquisition-payment-2',
    sourceTransactionId: 'transaction-2',
  },
] as const;

describe('registration transfer refund-plan coverage', () => {
  it('accepts one exact refund-plan link per current acquisition payment', () => {
    expect(
      refundPlansExactlyCoverCurrentAcquisitionPayments({
        currentAcquisitionId: 'acquisition-1',
        currentPayments,
        refundPlans: completePlans,
      }),
    ).toBe(true);
  });

  it('rejects a missing refund plan or acquisition link hidden by an inner join', () => {
    expect(
      refundPlansExactlyCoverCurrentAcquisitionPayments({
        currentAcquisitionId: 'acquisition-1',
        currentPayments,
        refundPlans: completePlans.slice(0, 1),
      }),
    ).toBe(false);
  });

  it('rejects duplicate or mismatched payment linkage', () => {
    expect(
      refundPlansExactlyCoverCurrentAcquisitionPayments({
        currentAcquisitionId: 'acquisition-1',
        currentPayments,
        refundPlans: [completePlans[0], completePlans[0]],
      }),
    ).toBe(false);
    expect(
      refundPlansExactlyCoverCurrentAcquisitionPayments({
        currentAcquisitionId: 'acquisition-1',
        currentPayments,
        refundPlans: [
          completePlans[0],
          {
            ...completePlans[1],
            sourceTransactionId: 'transaction-1',
          },
        ],
      }),
    ).toBe(false);
  });
});
