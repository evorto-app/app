import { Schema } from 'effect';

export const EVENT_CHECK_IN_PRE_START_WINDOW_MS = 60 * 60 * 1000;
export const EVENT_CHECK_IN_POST_END_GRACE_MS = 2 * 60 * 60 * 1000;

export const EventCheckInTimingIssue = Schema.Literals(['ended', 'notOpen']);
export type EventCheckInTimingIssue = Schema.Schema.Type<
  typeof EventCheckInTimingIssue
>;

export const eventCheckInTimingMessage = (
  issue: EventCheckInTimingIssue,
): string =>
  issue === 'ended'
    ? 'Check-in closed two hours after this event ended'
    : 'Check-in opens one hour before this event starts';

export const eventCheckInTimingIssue = ({
  end,
  now,
  start,
}: {
  readonly end: Date;
  readonly now: Date;
  readonly start: Date;
}): EventCheckInTimingIssue | null => {
  if (now.getTime() < start.getTime() - EVENT_CHECK_IN_PRE_START_WINDOW_MS) {
    return 'notOpen';
  }
  if (now.getTime() > end.getTime() + EVENT_CHECK_IN_POST_END_GRACE_MS) {
    return 'ended';
  }
  return null;
};
