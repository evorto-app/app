import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';

import { registrationTimeBeforeStart } from './registration-window-offset';

const before = (
  start: string,
  offsetHours: number,
  zone = 'Europe/Berlin',
): string =>
  registrationTimeBeforeStart(
    DateTime.fromISO(start, { zone }),
    offsetHours,
  ).toISO({ suppressMilliseconds: true }) ?? 'invalid';

describe('registrationTimeBeforeStart', () => {
  it.each([
    // Sat 2026-10-31 19:00, DST ended Sun 2026-10-25: still 19:00 a week earlier.
    ['2026-10-31T19:00', 168, '2026-10-24T19:00:00+02:00'],
    // Thu 2027-04-01 19:00, DST starts Sun 2027-03-28.
    ['2027-04-01T19:00', 168, '2027-03-25T19:00:00+01:00'],
    // Thu 2027-11-04 19:00, DST ends Sun 2027-10-31.
    ['2027-11-04T19:00', 168, '2027-10-28T19:00:00+02:00'],
    // One day before an event on the switch day itself.
    ['2027-03-28T12:00', 24, '2027-03-27T12:00:00+01:00'],
  ])(
    'keeps the clock time when %s minus %i h crosses a DST change',
    (start, offsetHours, expected) => {
      expect(before(start, offsetHours)).toBe(expected);
    },
  );

  it('leaves windows without a DST change unchanged', () => {
    const start = DateTime.fromISO('2027-05-06T19:00', {
      zone: 'Europe/Berlin',
    });
    const opens = registrationTimeBeforeStart(start, 168);

    expect(opens.toISO({ suppressMilliseconds: true })).toBe(
      '2027-04-29T19:00:00+02:00',
    );
    expect(start.toMillis() - opens.toMillis()).toBe(168 * 3_600_000);
  });

  it('keeps the remaining hours of an offset that is not a whole number of days as elapsed time', () => {
    // 36 h = 1 day + 12 h. The day step lands on Sun 2027-03-28 08:00 CEST;
    // the 12 h then run across the switch as elapsed time.
    expect(before('2027-03-29T08:00', 36)).toBe('2027-03-27T19:00:00+01:00');
    // A close offset of 1 h just after the switch is one real hour.
    expect(before('2027-03-28T03:30', 1)).toBe('2027-03-28T01:30:00+01:00');
    expect(before('2027-04-01T19:00', 168.5)).toBe('2027-03-25T18:30:00+01:00');
  });

  it('returns the start for a zero offset', () => {
    expect(before('2027-04-01T19:00', 0)).toBe('2027-04-01T19:00:00+02:00');
  });

  it('moves a negative offset after the start', () => {
    expect(before('2027-03-26T19:00', -24)).toBe('2027-03-27T19:00:00+01:00');
  });

  it('works in the zone of the start and keeps that zone', () => {
    expect(before('2027-04-01T19:00', 168, 'Europe/Prague')).toBe(
      '2027-03-25T19:00:00+01:00',
    );
    expect(before('2027-04-01T19:00', 168, 'Australia/Brisbane')).toBe(
      '2027-03-25T19:00:00+10:00',
    );
    expect(
      registrationTimeBeforeStart(
        DateTime.fromISO('2027-04-01T19:00', { zone: 'Europe/Berlin' }),
        168,
      ).zoneName,
    ).toBe('Europe/Berlin');
  });

  it('shifts a result that falls into the skipped hour forward', () => {
    // Sun 2027-04-04 02:30 minus 7 days would be Sun 2027-03-28 02:30, which
    // does not exist in Europe/Berlin.
    expect(before('2027-04-04T02:30', 168)).toBe('2027-03-28T03:30:00+02:00');
  });
});
