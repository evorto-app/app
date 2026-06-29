import { describe, expect, it } from 'vitest';

import { eventReviewQueueActionDisabled } from './event-reviews.component';

describe('eventReviewQueueActionDisabled', () => {
  it('blocks review queue actions while a review mutation is pending', () => {
    expect(
      eventReviewQueueActionDisabled({
        actionPending: false,
        mutationPending: false,
      }),
    ).toBe(false);
    expect(
      eventReviewQueueActionDisabled({
        actionPending: false,
        mutationPending: true,
      }),
    ).toBe(true);
    expect(
      eventReviewQueueActionDisabled({
        actionPending: true,
        mutationPending: false,
      }),
    ).toBe(true);
  });
});
