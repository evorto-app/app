import { describe, expect, it } from 'vitest';

import { receiptReviewSuccessMessage } from './receipt-approval-detail.component';

describe('receiptReviewSuccessMessage', () => {
  it('keeps approval feedback honest about manual submitter notification', () => {
    expect(receiptReviewSuccessMessage('approved')).toBe(
      'Receipt approved. Notify the submitter manually.',
    );
  });

  it('keeps rejection feedback honest about manual submitter notification', () => {
    expect(receiptReviewSuccessMessage('rejected')).toBe(
      'Receipt rejected. Notify the submitter manually.',
    );
  });
});
