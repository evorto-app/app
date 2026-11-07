import { type DateTime } from 'luxon';

/**
 * Applies a template registration offset ("N hours before the event start")
 * to an event start.
 *
 * Whole days count as calendar days in the zone of `start`, so "7 days before
 * Thursday 19:00" is Thursday 19:00 a week earlier even when a DST change falls
 * in between. The remaining hours (`offsetHours % 24`) are elapsed time. A
 * negative offset moves the result after the start.
 *
 * Pass `start` in the tenant's time zone; the result keeps that zone.
 */
export const registrationTimeBeforeStart = (
  start: DateTime,
  offsetHours: number,
): DateTime => {
  const days = Math.trunc(offsetHours / 24);
  const hours = offsetHours - days * 24;
  return start.minus({ days }).minus({ hours });
};
