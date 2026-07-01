import { describe, expect, it } from 'vitest';

import {
  receiptReviewActionDisabled,
  receiptReviewNotificationNotice,
  receiptReviewSuccessMessage,
} from './receipt-approval-detail.component';

describe('receiptReviewSuccessMessage', () => {
  it('explains that review actions notify the submitter', () => {
    expect(receiptReviewNotificationNotice).toBe(
      'Approving or rejecting this receipt emails the submitter after saving.',
    );
  });

  it('keeps approval feedback honest about submitter notification', () => {
    expect(receiptReviewSuccessMessage('approved')).toBe(
      'Receipt approved and the submitter was notified.',
    );
  });

  it('keeps rejection feedback honest about submitter notification', () => {
    expect(receiptReviewSuccessMessage('rejected')).toBe(
      'Receipt rejected and the submitter was notified.',
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
