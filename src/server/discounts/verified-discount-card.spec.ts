import { describe, expect, it } from '@effect/vitest';

import { verifiedDiscountCardCoversEvent } from './verified-discount-card';

describe('verifiedDiscountCardCoversEvent', () => {
  const eventStart = new Date('2026-08-01T12:00:00.000Z');

  it('uses the persisted validity window', () => {
    expect(
      verifiedDiscountCardCoversEvent(
        {
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: new Date('2026-12-31T00:00:00.000Z'),
        },
        eventStart,
      ),
    ).toBe(true);
    expect(
      verifiedDiscountCardCoversEvent(
        {
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: new Date('2026-07-31T00:00:00.000Z'),
        },
        eventStart,
      ),
    ).toBe(false);
  });

  it('includes activation and excludes expiration at the event start', () => {
    expect(
      verifiedDiscountCardCoversEvent(
        {
          validFrom: eventStart,
          validTo: new Date('2026-12-31T00:00:00.000Z'),
        },
        eventStart,
      ),
    ).toBe(true);
    expect(
      verifiedDiscountCardCoversEvent(
        {
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validTo: eventStart,
        },
        eventStart,
      ),
    ).toBe(false);
    expect(
      verifiedDiscountCardCoversEvent(
        {
          validFrom: new Date('2026-08-02T00:00:00.000Z'),
          validTo: new Date('2026-12-31T00:00:00.000Z'),
        },
        eventStart,
      ),
    ).toBe(false);
  });

  it('surfaces a verified card without a complete validity window', () => {
    expect(() =>
      verifiedDiscountCardCoversEvent(
        { validFrom: null, validTo: null },
        eventStart,
      ),
    ).toThrow('Verified discount card is missing its validity window');
  });

  it('surfaces an inverted validity window', () => {
    expect(() =>
      verifiedDiscountCardCoversEvent(
        {
          validFrom: new Date('2027-01-01T00:00:00.000Z'),
          validTo: new Date('2026-12-31T00:00:00.000Z'),
        },
        eventStart,
      ),
    ).toThrow('Verified discount card has an invalid validity window');
  });
});
