import { describe, expect, it } from 'vitest';

import { readRegistrationPriceSnapshot } from './registration-price-snapshot';

const noDiscountSnapshot = {
  appliedDiscountedPrice: null,
  appliedDiscountType: null,
  basePriceAtRegistration: 1200,
  discountAmount: 0,
} as const;

describe('registration price snapshot reads', () => {
  it.each([
    { paymentPending: false, status: 'CONFIRMED' as const },
    { paymentPending: true, status: 'PENDING' as const },
  ])('requires a complete snapshot for $status', (state) => {
    expect(() =>
      readRegistrationPriceSnapshot({
        appliedDiscountedPrice: null,
        appliedDiscountType: null,
        basePriceAtRegistration: null,
        discountAmount: null,
        registrationId: 'registration-1',
        ...state,
      }),
    ).toThrow('Registration registration-1 has an incomplete price snapshot');

    expect(
      readRegistrationPriceSnapshot({
        ...noDiscountSnapshot,
        registrationId: 'registration-1',
        ...state,
      }),
    ).toEqual(noDiscountSnapshot);
  });

  it.each([
    { paymentPending: false, status: 'PENDING' as const },
    { paymentPending: false, status: 'WAITLIST' as const },
  ])('allows an entirely absent snapshot for $status', (state) => {
    expect(
      readRegistrationPriceSnapshot({
        appliedDiscountedPrice: null,
        appliedDiscountType: null,
        basePriceAtRegistration: null,
        discountAmount: null,
        registrationId: 'registration-1',
        ...state,
      }),
    ).toEqual({
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePriceAtRegistration: null,
      discountAmount: null,
    });
  });

  it('rejects partial and mathematically inconsistent snapshots', () => {
    expect(() =>
      readRegistrationPriceSnapshot({
        ...noDiscountSnapshot,
        basePriceAtRegistration: null,
        paymentPending: false,
        registrationId: 'registration-1',
        status: 'WAITLIST',
      }),
    ).toThrow('Registration registration-1 has an incomplete price snapshot');

    expect(() =>
      readRegistrationPriceSnapshot({
        appliedDiscountedPrice: 900,
        appliedDiscountType: 'esnCard',
        basePriceAtRegistration: 1200,
        discountAmount: 200,
        paymentPending: false,
        registrationId: 'registration-1',
        status: 'CONFIRMED',
      }),
    ).toThrow('Registration registration-1 has an inconsistent price snapshot');
  });
});
