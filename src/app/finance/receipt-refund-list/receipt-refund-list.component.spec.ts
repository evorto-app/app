import { describe, expect, it } from 'vitest';

import { receiptReimbursementManualNotice } from './receipt-refund-list.component';

describe('receiptReimbursementManualNotice', () => {
  it('keeps reimbursement copy honest about manual money movement', () => {
    expect(receiptReimbursementManualNotice).toBe(
      'Recording a reimbursement creates the Evorto finance transaction only. Transfer the money manually through the selected payout method.',
    );
  });
});
