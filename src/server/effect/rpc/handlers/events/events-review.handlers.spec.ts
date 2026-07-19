import { describe, expect, it } from 'vitest';

import { eventReviewDecision } from './events-review.handlers';

describe('eventReviewDecision', () => {
  it('returns a negative review to draft with normalized feedback', () => {
    expect(
      eventReviewDecision({
        approved: false,
        comment: '  Add clearer safety guidance.  ',
      }),
    ).toEqual({
      status: 'DRAFT',
      statusComment: 'Add clearer safety guidance.',
    });
  });

  it('requires meaningful feedback before returning an event to draft', () => {
    expect(eventReviewDecision({ approved: false })).toBeUndefined();
    expect(
      eventReviewDecision({ approved: false, comment: ' '.repeat(3) }),
    ).toBeUndefined();
  });

  it('publishes an approved review without requiring feedback', () => {
    expect(eventReviewDecision({ approved: true })).toEqual({
      status: 'APPROVED',
      statusComment: null,
    });
  });
});
