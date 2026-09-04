import { describe, expect, it } from 'vitest';

import { eventReviewActionErrorRequiresRefresh } from './event-rpc-error';

describe('eventReviewActionErrorRequiresRefresh', () => {
  it('refreshes only for the typed review conflict', () => {
    expect(
      eventReviewActionErrorRequiresRefresh({
        _tag: 'EventConflictError',
        message: 'copy can change without changing recovery',
      }),
    ).toBe(true);
    expect(
      eventReviewActionErrorRequiresRefresh({
        _tag: 'EventNotFoundError',
        message: 'conflict',
      }),
    ).toBe(false);
    expect(
      eventReviewActionErrorRequiresRefresh(
        new Error('status changed; refresh and try again'),
      ),
    ).toBe(false);
  });
});
