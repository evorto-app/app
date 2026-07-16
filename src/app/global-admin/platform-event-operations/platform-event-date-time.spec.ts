import { describe, expect, it } from 'vitest';

import {
  platformEventInstantRangeHasValidOrder,
  platformEventInstantToDisplayDateTime,
  platformEventInstantToLocalDateTime,
  platformEventLocalDateTimeRangeHasValidOrder,
  platformEventLocalDateTimeToInstant,
} from './platform-event-date-time';

describe('platform event target-tenant date-time conversion', () => {
  it('renders an instant in the target tenant timezone', () => {
    const instant = '2026-01-15T23:30:00.000Z';

    expect(
      platformEventInstantToLocalDateTime(instant, 'Australia/Brisbane'),
    ).toBe('2026-01-16T09:30');
    expect(platformEventInstantToLocalDateTime(instant, 'Europe/Berlin')).toBe(
      '2026-01-16T00:30',
    );
  });

  it('formats a display value in the target IANA timezone', () => {
    const instant = '2026-01-15T23:30:00.000Z';

    expect(
      platformEventInstantToDisplayDateTime(instant, 'Australia/Brisbane'),
    ).toBe('16 Jan 2026, 09:30');
    expect(
      platformEventInstantToDisplayDateTime(instant, 'Europe/Berlin'),
    ).toBe('16 Jan 2026, 00:30');
  });

  it('serializes a target-tenant wall time to its UTC instant', () => {
    expect(
      platformEventLocalDateTimeToInstant(
        '2026-01-16T09:30',
        'Australia/Brisbane',
      ),
    ).toBe('2026-01-15T23:30:00.000Z');
    expect(
      platformEventLocalDateTimeToInstant('2026-01-16T09:30', 'Europe/Berlin'),
    ).toBe('2026-01-16T08:30:00.000Z');
  });

  it('rejects wall times skipped by a target-tenant DST transition', () => {
    expect(
      platformEventLocalDateTimeToInstant('2026-03-29T02:30', 'Europe/Berlin'),
    ).toBeNull();
  });

  it('rejects wall times repeated by a target-tenant DST transition', () => {
    expect(
      platformEventLocalDateTimeToInstant('2026-10-25T02:30', 'Europe/Berlin'),
    ).toBeNull();
  });

  it('compares target-tenant wall times only after valid timezone conversion', () => {
    expect(
      platformEventLocalDateTimeRangeHasValidOrder(
        '2026-01-16T09:30',
        '2026-01-16T10:30',
        'Australia/Brisbane',
      ),
    ).toBe(true);
    expect(
      platformEventLocalDateTimeRangeHasValidOrder(
        '2026-01-16T09:30',
        '2026-01-16T09:30',
        'Australia/Brisbane',
      ),
    ).toBe(false);
    expect(
      platformEventLocalDateTimeRangeHasValidOrder(
        '2026-03-29T02:30',
        '2026-03-29T04:30',
        'Europe/Berlin',
      ),
    ).toBeNull();
  });

  it('supports inclusive registration-window ordering', () => {
    const instant = '2026-01-15T23:30:00.000Z';

    expect(platformEventInstantRangeHasValidOrder(instant, instant)).toBe(
      false,
    );
    expect(platformEventInstantRangeHasValidOrder(instant, instant, true)).toBe(
      true,
    );
  });
});
