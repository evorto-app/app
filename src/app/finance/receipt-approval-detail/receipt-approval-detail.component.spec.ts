import { describe, expect, it } from 'vitest';

import { receiptAmountValidationError } from '../shared/receipt-form/receipt-form.model';
import {
  receiptReviewActionDisabled,
  receiptReviewNotificationNotice,
  receiptReviewSuccessMessage,
} from './receipt-approval-detail.component';

describe('receiptReviewSuccessMessage', () => {
  it('shows the queued notification caveat before review actions', () => {
    expect(receiptReviewNotificationNotice).toBe(
      'Approving or rejecting this receipt records the review status and queues a submitter email after saving.',
    );
  });

  it('keeps approval feedback honest about queued submitter notification', () => {
    expect(receiptReviewSuccessMessage('approved')).toBe(
      'Receipt approved. Submitter email queued.',
    );
  });

  it('keeps rejection feedback honest about queued submitter notification', () => {
    expect(receiptReviewSuccessMessage('rejected')).toBe(
      'Receipt rejected. Submitter email queued.',
    );
  });
});

describe('receiptAmountValidationError', () => {
  it('keeps receipt review amount preflight aligned with submit/server checks', () => {
    expect(
      receiptAmountValidationError({
        alcoholAmount: 200,
        depositAmount: 300,
        taxAmount: 100,
        totalAmount: 400,
      }),
    ).toBe('breakdownExceedsTotal');

    expect(
      receiptAmountValidationError({
        alcoholAmount: 0,
        depositAmount: 0,
        taxAmount: 500,
        totalAmount: 400,
      }),
    ).toBe('taxExceedsTotal');

    expect(
      receiptAmountValidationError({
        alcoholAmount: 100,
        depositAmount: 100,
        taxAmount: 100,
        totalAmount: 400,
      }),
    ).toBeNull();
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
