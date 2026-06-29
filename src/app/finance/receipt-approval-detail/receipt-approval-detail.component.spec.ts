import { describe, expect, it } from 'vitest';

import {
  receiptReviewActionDisabled,
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

describe('receiptReviewActionDisabled', () => {
  it('blocks review writes while the form is invalid, the receipt is loading, or the mutation is pending', () => {
    expect(
      receiptReviewActionDisabled({
        formInvalid: false,
        mutationPending: false,
        receiptPending: false,
      }),
    ).toBe(false);
    expect(
      receiptReviewActionDisabled({
        formInvalid: true,
        mutationPending: false,
        receiptPending: false,
      }),
    ).toBe(true);
    expect(
      receiptReviewActionDisabled({
        formInvalid: false,
        mutationPending: false,
        receiptPending: true,
      }),
    ).toBe(true);
    expect(
      receiptReviewActionDisabled({
        formInvalid: false,
        mutationPending: true,
        receiptPending: false,
      }),
    ).toBe(true);
  });
});
