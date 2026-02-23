import { describe, expect, it } from 'vitest';

import { financeHandlers } from './finance.handlers';

describe('financeHandlers composition', () => {
  it('contains the full finance rpc handler set', () => {
    expect(Object.keys(financeHandlers).toSorted()).toEqual([
      'finance.receiptMedia.uploadOriginal',
      'finance.receipts.byEvent',
      'finance.receipts.createRefund',
      'finance.receipts.findOneForApproval',
      'finance.receipts.my',
      'finance.receipts.pendingApprovalGrouped',
      'finance.receipts.refundableGroupedByRecipient',
      'finance.receipts.review',
      'finance.receipts.submit',
      'finance.transactions.findMany',
    ]);
  });
});
