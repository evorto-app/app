import { describe, expect, it } from 'vitest';

import { legacyEventReviewStatus } from '../../migration/legacy-event-publication';

describe('legacy event publication mapping', () => {
  it('preserves representable draft, review, and public states', () => {
    expect(legacyEventReviewStatus('DRAFT')).toBe('DRAFT');
    expect(legacyEventReviewStatus('APPROVAL')).toBe('PENDING_REVIEW');
    expect(legacyEventReviewStatus('PUBLIC')).toBe('APPROVED');
  });

  it('blocks organizer-only publication instead of exposing it publicly', () => {
    expect(() => legacyEventReviewStatus('ORGANIZERS')).toThrow(
      'organizer-only publication has no target representation',
    );
  });
});
