import { describe, expect, it } from 'vitest';

import { normalizeFinanceTransactionRecord } from './finance.shared';

describe('normalizeFinanceTransactionRecord', () => {
  it('retains the currency recorded with the immutable transaction', () => {
    expect(
      normalizeFinanceTransactionRecord({
        amount: 25_000,
        appFee: 500,
        comment: 'Event registration',
        createdAt: new Date('2026-07-10T10:00:00.000Z'),
        currency: 'CZK',
        id: 'transaction-1',
        method: 'stripe',
        status: 'successful',
        stripeFee: 750,
      }),
    ).toMatchObject({
      amount: 25_000,
      currency: 'CZK',
      id: 'transaction-1',
    });
  });
});
