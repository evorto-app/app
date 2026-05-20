import { describe, expect, it } from 'vitest';

import {
  receiptReimbursementCanRecord,
  receiptReimbursementManualNotice,
  receiptReimbursementPayoutDetailLabel,
  receiptReimbursementRecordDisabled,
  receiptReimbursementSelectedTotal,
} from './receipt-refund-list.component';

describe('receiptReimbursementManualNotice', () => {
  it('keeps reimbursement copy honest about manual money movement', () => {
    expect(receiptReimbursementManualNotice).toBe(
      'Recording a reimbursement creates the Evorto finance transaction only. Transfer the money manually through the selected payout method.',
    );
  });
});

describe('receiptReimbursementCanRecord', () => {
  it('requires at least one selected receipt', () => {
    expect(
      receiptReimbursementCanRecord(
        [],
        { iban: 'DE123', paypalEmail: null },
        'iban',
      ),
    ).toBe(false);
  });

  it('requires the selected payout detail to exist', () => {
    expect(
      receiptReimbursementCanRecord(
        ['receipt-1'],
        { iban: null, paypalEmail: 'pay@example.com' },
        'iban',
      ),
    ).toBe(false);
    expect(
      receiptReimbursementCanRecord(
        ['receipt-1'],
        { iban: null, paypalEmail: 'pay@example.com' },
        'paypal',
      ),
    ).toBe(true);
  });
});

describe('receiptReimbursementRecordDisabled', () => {
  it('disables reimbursement recording when the selected group cannot be recorded', () => {
    expect(
      receiptReimbursementRecordDisabled({
        canRecord: false,
        mutationPending: false,
      }),
    ).toBe(true);
  });

  it('disables reimbursement recording while a refund mutation is pending', () => {
    expect(
      receiptReimbursementRecordDisabled({
        canRecord: true,
        mutationPending: true,
      }),
    ).toBe(true);
  });

  it('allows reimbursement recording only when the selection and mutation are ready', () => {
    expect(
      receiptReimbursementRecordDisabled({
        canRecord: true,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('receiptReimbursementPayoutDetailLabel', () => {
  it('labels configured and missing payout details', () => {
    expect(receiptReimbursementPayoutDetailLabel('iban', 'DE123')).toBe(
      'IBAN: DE123',
    );
    expect(receiptReimbursementPayoutDetailLabel('paypal', null)).toBe(
      'PayPal: not set',
    );
  });
});

describe('receiptReimbursementSelectedTotal', () => {
  it('sums only selected receipt rows', () => {
    expect(
      receiptReimbursementSelectedTotal(
        [
          { id: 'receipt-1', totalAmount: 1299 },
          { id: 'receipt-2', totalAmount: 2500 },
          { id: 'receipt-3', totalAmount: 999 },
        ],
        ['receipt-1', 'receipt-3'],
      ),
    ).toBe(2298);
  });
});
