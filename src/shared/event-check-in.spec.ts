import { describe, expect, it } from 'vitest';

import {
  EVENT_CHECK_IN_POST_END_GRACE_MS,
  EVENT_CHECK_IN_PRE_START_WINDOW_MS,
  eventCheckInTimingIssue,
} from './event-check-in';

const start = new Date('2026-09-15T12:00:00.000Z');
const end = new Date('2026-09-15T14:00:00.000Z');

const issueAt = (milliseconds: number) =>
  eventCheckInTimingIssue({
    end,
    now: new Date(milliseconds),
    start,
  });

describe('event check-in window', () => {
  it('opens exactly one hour before the event starts', () => {
    expect(
      issueAt(start.getTime() - EVENT_CHECK_IN_PRE_START_WINDOW_MS - 1),
    ).toBe('notOpen');
    expect(
      issueAt(start.getTime() - EVENT_CHECK_IN_PRE_START_WINDOW_MS),
    ).toBeNull();
  });

  it('stays open through the two-hour post-event grace boundary', () => {
    expect(
      issueAt(end.getTime() + EVENT_CHECK_IN_POST_END_GRACE_MS),
    ).toBeNull();
    expect(issueAt(end.getTime() + EVENT_CHECK_IN_POST_END_GRACE_MS + 1)).toBe(
      'ended',
    );
  });
});
