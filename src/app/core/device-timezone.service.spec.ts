import { describe, expect, it } from 'vitest';

import { shouldShowTimezone } from './device-timezone.service';

describe('timezone label visibility', () => {
  it('hides the label for the same timezone', () => {
    expect(shouldShowTimezone('Europe/Berlin', 'Europe/Berlin')).toBe(false);
  });

  it('recognizes aliases for the same timezone', () => {
    expect(shouldShowTimezone('UTC', 'Etc/UTC')).toBe(false);
    expect(shouldShowTimezone('America/New_York', 'US/Eastern')).toBe(false);
  });

  it('keeps the label for different zones even when their current offsets match', () => {
    expect(shouldShowTimezone('Europe/Berlin', 'Africa/Johannesburg')).toBe(
      true,
    );
    expect(shouldShowTimezone('Europe/London', 'UTC')).toBe(true);
  });

  it('keeps the label until the device timezone is known', () => {
    expect(shouldShowTimezone('Europe/Berlin', null)).toBe(true);
  });
});
