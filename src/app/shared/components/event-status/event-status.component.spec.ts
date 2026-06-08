import { describe, expect, it } from 'vitest';

import { eventStatusLabel } from './event-status.component';

describe('eventStatusLabel', () => {
  it('uses published product language for approved events', () => {
    expect(eventStatusLabel('APPROVED')).toBe('Published');
  });

  it('keeps review workflow labels readable', () => {
    expect(eventStatusLabel('DRAFT')).toBe('Draft');
    expect(eventStatusLabel('PENDING_REVIEW')).toBe('Pending Review');
    expect(eventStatusLabel('REJECTED')).toBe('Rejected');
  });
});
