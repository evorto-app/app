import { describe, expect, it } from 'vitest';

import {
  receiptReviewActionDisabled,
  receiptReviewNotificationNotice,
  receiptReviewSuccessMessage,
} from './receipt-approval-detail.component';

describe('receiptReviewSuccessMessage', () => {
  it('explains that review actions queue submitter notification', () => {
    expect(receiptReviewNotificationNotice).toBe(
      'Approving or rejecting this receipt queues an email to the submitter after saving.',
    );
  });

  it('keeps approval feedback honest about queued submitter notification', () => {
    expect(receiptReviewSuccessMessage('approved')).toBe(
      'Receipt approved and the submitter notification was queued.',
    );
  });

  it('keeps rejection feedback honest about queued submitter notification', () => {
    expect(receiptReviewSuccessMessage('rejected')).toBe(
      'Receipt rejected and the submitter notification was queued.',
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
