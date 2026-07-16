import { describe, expect, it } from 'vitest';

import {
  legacyTimestamp,
  legacyTimestampDateTime,
} from '../../migration/legacy-timestamp';

describe('legacyTimestamp', () => {
  it('interprets zone-less legacy PostgreSQL timestamps as UTC', () => {
    expect(
      legacyTimestamp(
        '2025-07-01 10:15:30.123',
        'Legacy event start',
      ).toISOString(),
    ).toBe('2025-07-01T10:15:30.123Z');
    expect(
      legacyTimestampDateTime(
        '2025-01-01 12:00:00',
        'Legacy registration start',
      ).zoneName,
    ).toBe('UTC');
  });

  it('blocks invalid timestamps', () => {
    expect(() => legacyTimestamp('not-a-date', 'Legacy event start')).toThrow(
      'invalid legacy UTC timestamp',
    );
  });
});
