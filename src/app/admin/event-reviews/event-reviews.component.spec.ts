import { describe, expect, it } from 'vitest';

import { eventReviewQueueActionDisabled } from './event-reviews.component';

describe('eventReviewQueueActionDisabled', () => {
  it('blocks review queue actions while a review mutation is pending', () => {
    expect(
      eventReviewQueueActionDisabled({
        mutationPending: false,
      }),
    ).toBe(false);
    expect(
      eventReviewQueueActionDisabled({
        mutationPending: true,
      }),
    ).toBe(true);
  });
});
