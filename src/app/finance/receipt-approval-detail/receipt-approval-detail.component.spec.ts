import { describe, expect, it } from 'vitest';

import {
  receiptReviewNotificationNotice,
  receiptReviewSuccessMessage,
} from './receipt-approval-detail.component';

describe('receiptReviewSuccessMessage', () => {
  it('shows the manual notification caveat before review actions', () => {
    expect(receiptReviewNotificationNotice).toBe(
      'Approving or rejecting this receipt records the review status only. Notify the submitter manually after saving.',
    );
  });

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
