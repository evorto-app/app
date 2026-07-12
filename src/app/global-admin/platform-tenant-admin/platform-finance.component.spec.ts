import { describe, expect, it } from 'vitest';

import {
  platformReceiptEvidenceUnavailableNotice,
  platformReceiptReviewDisabled,
} from './platform-finance.component';

describe('platform receipt review evidence gating', () => {
  it('explains that unavailable evidence blocks only approval', () => {
    expect(platformReceiptEvidenceUnavailableNotice).toBe(
      'Receipt evidence is unavailable. Approval is disabled until the uploaded file can be verified. You can still reject this receipt.',
    );

    expect(
      platformReceiptReviewDisabled({
        evidenceAvailable: false,
        formInvalid: false,
        mutationPending: false,
        status: 'approved',
      }),
    ).toBe(true);
    expect(
      platformReceiptReviewDisabled({
        evidenceAvailable: false,
        formInvalid: false,
        mutationPending: false,
        status: 'rejected',
      }),
    ).toBe(false);
  });

  it('keeps normal form and mutation gating for both decisions', () => {
    expect(
      platformReceiptReviewDisabled({
        evidenceAvailable: true,
        formInvalid: true,
        mutationPending: false,
        status: 'approved',
      }),
    ).toBe(true);
    expect(
      platformReceiptReviewDisabled({
        evidenceAvailable: true,
        formInvalid: false,
        mutationPending: true,
        status: 'rejected',
      }),
    ).toBe(true);
  });
});
