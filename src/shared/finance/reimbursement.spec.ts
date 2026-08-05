import { describe, expect, it } from 'vitest';

import {
  maskFinancePayoutDestination,
  resolveFinanceReimbursementBatch,
} from './reimbursement';

describe('finance reimbursement batch policy', () => {
  it('returns the one recipient, currency, and positive minor-unit total', () => {
    expect(
      resolveFinanceReimbursementBatch([
        {
          currency: 'EUR',
          submittedByUserId: 'user-1',
          totalAmount: 1200,
        },
        {
          currency: 'EUR',
          submittedByUserId: 'user-1',
          totalAmount: 800,
        },
      ]),
    ).toEqual({
      currency: 'EUR',
      error: null,
      targetUserId: 'user-1',
      totalAmount: 2000,
    });
  });

  it('returns one explicit error for empty, mixed, or invalid batches', () => {
    expect(resolveFinanceReimbursementBatch([]).error?.reason).toBe(
      'missingTargetUser',
    );
    expect(
      resolveFinanceReimbursementBatch([
        {
          currency: 'EUR',
          submittedByUserId: 'user-1',
          totalAmount: 100,
        },
        {
          currency: 'EUR',
          submittedByUserId: 'user-2',
          totalAmount: 100,
        },
      ]).error?.reason,
    ).toBe('mismatchedSubmitter');
    expect(
      resolveFinanceReimbursementBatch([
        {
          currency: 'EUR',
          submittedByUserId: 'user-1',
          totalAmount: 100,
        },
        {
          currency: 'CZK',
          submittedByUserId: 'user-1',
          totalAmount: 100,
        },
      ]).error?.reason,
    ).toBe('mismatchedReceiptCurrency');
    expect(
      resolveFinanceReimbursementBatch([
        {
          currency: 'EUR',
          submittedByUserId: 'user-1',
          totalAmount: 0,
        },
      ]).error?.reason,
    ).toBe('invalidReimbursementTotal');
    expect(
      resolveFinanceReimbursementBatch([
        {
          currency: 'EUR',
          submittedByUserId: 'user-1',
          totalAmount: 2_147_483_647,
        },
        {
          currency: 'EUR',
          submittedByUserId: 'user-1',
          totalAmount: 1,
        },
      ]).error?.reason,
    ).toBe('invalidReimbursementTotal');
  });
});

describe('finance payout masking', () => {
  it('retains only enough payout detail for an operator-safe audit trail', () => {
    expect(maskFinancePayoutDestination('iban', 'DE89370400440532013000')).toBe(
      '•••• 3000',
    );
    expect(
      maskFinancePayoutDestination('paypal', 'participant@example.test'),
    ).toBe('p•••@e•••.test');
  });
});
