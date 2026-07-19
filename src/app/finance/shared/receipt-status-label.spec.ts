import { describe, expect, it } from 'vitest';

import { receiptStatusLabel } from './receipt-status-label';

describe('receiptStatusLabel', () => {
  it('uses product language for every persisted receipt state', () => {
    expect(receiptStatusLabel('submitted')).toBe('Submitted');
    expect(receiptStatusLabel('approved')).toBe('Approved');
    expect(receiptStatusLabel('rejected')).toBe('Rejected');
    expect(receiptStatusLabel('refunded')).toBe('Reimbursed');
  });
});
