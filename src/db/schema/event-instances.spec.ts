import { describe, expect, it } from 'vitest';

import { eventReviewStatus } from './event-instances';

describe('eventReviewStatus', () => {
  it('keeps rejection as a return to draft rather than a durable state', () => {
    expect(eventReviewStatus.enumValues).toEqual([
      'DRAFT',
      'PENDING_REVIEW',
      'APPROVED',
    ]);
  });
});
