import { describe, expect, it } from 'vitest';

import {
  registrationTransferTotalPrice,
  resolveRegistrationTransferPrice,
} from './registration-transfer-pricing';

describe('registration transfer pricing', () => {
  it('uses the recipient current best eligible discount', () => {
    expect(
      resolveRegistrationTransferPrice({
        basePrice: 2500,
        cards: [{ type: 'esnCard', validTo: null }],
        discounts: [
          { discountedPrice: 1800, discountType: 'esnCard' },
          { discountedPrice: 1500, discountType: 'esnCard' },
        ],
        enabledDiscountTypes: new Set(['esnCard']),
        eventStart: new Date('2026-09-01T18:00:00.000Z'),
      }),
    ).toEqual({
      appliedDiscountedPrice: 1500,
      appliedDiscountType: 'esnCard',
      discountAmount: 1000,
      effectivePrice: 1500,
    });
  });

  it('does not reuse an expired, disabled, or different users discount', () => {
    expect(
      resolveRegistrationTransferPrice({
        basePrice: 2500,
        cards: [
          {
            type: 'esnCard',
            validTo: new Date('2026-08-01T00:00:00.000Z'),
          },
        ],
        discounts: [{ discountedPrice: 1500, discountType: 'esnCard' }],
        enabledDiscountTypes: new Set(),
        eventStart: new Date('2026-09-01T18:00:00.000Z'),
      }),
    ).toEqual({
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      discountAmount: null,
      effectivePrice: 2500,
    });
  });

  it('prices current guests and add-ons independently of the source purchase', () => {
    expect(
      registrationTransferTotalPrice({
        addOnTotal: 900,
        effectivePrice: 1500,
        guestCount: 2,
        guestUnitPrice: 2500,
      }),
    ).toBe(7400);
  });
});
