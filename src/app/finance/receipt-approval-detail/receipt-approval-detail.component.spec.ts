import { describe, expect, it } from 'vitest';

import {
  receiptApprovalDisabled,
  receiptEvidenceUnavailableNotice,
  receiptRejectionDisabled,
  receiptReviewActionDisabled,
  receiptReviewNotificationNotice,
  receiptReviewSuccessMessage,
} from './receipt-approval-detail.component';

describe('receiptReviewSuccessMessage', () => {
  it('explains that review actions queue submitter notification', () => {
    expect(receiptReviewNotificationNotice).toBe(
      'Saving this decision asks Evorto to email the submitter. Delivery may take time or fail.',
    );
  });

  it('explains why approval is unavailable without blocking rejection', () => {
    expect(receiptEvidenceUnavailableNotice).toBe(
      'The uploaded receipt file is unavailable. You cannot approve the receipt until the file can be checked, but you can still reject it.',
    );
  });

  it('explains that approval emails the submitter', () => {
    expect(receiptReviewSuccessMessage('approved')).toBe(
      'Receipt approved. Evorto will now try to email the submitter.',
    );
  });

  it('explains that rejection emails the submitter', () => {
    expect(receiptReviewSuccessMessage('rejected')).toBe(
      'Receipt rejected. Evorto will now try to email the submitter.',
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

  it('blocks approval but still permits a reasoned rejection when receipt evidence is unavailable', () => {
    const reviewState = {
      formInvalid: false,
      mutationPending: false,
      receiptPending: false,
    };

    expect(
      receiptApprovalDisabled({
        evidenceAvailable: false,
        ...reviewState,
      }),
    ).toBe(true);
    expect(
      receiptRejectionDisabled({
        rejectionReason: 'The uploaded file cannot be verified.',
        ...reviewState,
      }),
    ).toBe(false);
    expect(
      receiptApprovalDisabled({
        evidenceAvailable: true,
        ...reviewState,
      }),
    ).toBe(false);
  });
});

describe('receiptRejectionDisabled', () => {
  it('requires a nonblank reason before a receipt can be rejected', () => {
    const reviewState = {
      formInvalid: false,
      mutationPending: false,
      receiptPending: false,
    };

    expect(
      receiptRejectionDisabled({ rejectionReason: '', ...reviewState }),
    ).toBe(true);
    expect(
      receiptRejectionDisabled({
        rejectionReason: ' '.repeat(3),
        ...reviewState,
      }),
    ).toBe(true);
    expect(
      receiptRejectionDisabled({
        rejectionReason: 'The receipt date is unreadable.',
        ...reviewState,
      }),
    ).toBe(false);
    expect(
      receiptRejectionDisabled({
        rejectionReason: 'The receipt date is unreadable.',
        ...reviewState,
        mutationPending: true,
      }),
    ).toBe(true);
  });
});
