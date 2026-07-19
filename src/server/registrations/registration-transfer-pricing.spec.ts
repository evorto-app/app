import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';

import { maximumPersistedPaymentAmount } from '../payments/payment-amount';
import {
  registrationTransferBasePrice,
  RegistrationTransferPricingError,
  registrationTransferTotalPrice,
  resolveRegistrationTransferClaimPricing,
  resolveRegistrationTransferPrice,
} from './registration-transfer-pricing';

describe('registration transfer pricing', () => {
  it('treats a disabled paid flag as free even when a stale price remains', () => {
    expect(registrationTransferBasePrice({ isPaid: false, price: 2500 })).toBe(
      0,
    );
    expect(registrationTransferBasePrice({ isPaid: true, price: 2500 })).toBe(
      2500,
    );
  });

  it('uses the recipient current best eligible discount', () => {
    expect(
      resolveRegistrationTransferPrice({
        basePrice: 2500,
        cards: [{ type: 'esnCard', validFrom: null, validTo: null }],
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

  it('keeps sealed claim pricing after Checkout starts', () => {
    const currentPricing = {
      appliedDiscountedPrice: 900,
      appliedDiscountType: 'esnCard' as const,
      discountAmount: 1600,
      effectivePrice: 900,
    };

    expect(
      resolveRegistrationTransferClaimPricing({
        appliedDiscountedPrice: 1500,
        appliedDiscountType: 'esnCard',
        basePrice: 2500,
        discountAmount: 1000,
        mode: 'sealed',
      }),
    ).toEqual({
      appliedDiscountedPrice: 1500,
      appliedDiscountType: 'esnCard',
      basePrice: 2500,
      discountAmount: 1000,
      effectivePrice: 1500,
      sealed: true,
    });
    expect(
      resolveRegistrationTransferClaimPricing({
        basePrice: 3200,
        mode: 'current',
        pricing: currentPricing,
      }),
    ).toEqual({
      ...currentPricing,
      basePrice: 3200,
      sealed: false,
    });
  });

  it('uses the sealed base price when no recipient discount applied', () => {
    expect(
      resolveRegistrationTransferClaimPricing({
        appliedDiscountedPrice: null,
        appliedDiscountType: null,
        basePrice: 2500,
        discountAmount: null,
        mode: 'sealed',
      }),
    ).toEqual({
      appliedDiscountedPrice: null,
      appliedDiscountType: null,
      basePrice: 2500,
      discountAmount: null,
      effectivePrice: 2500,
      sealed: true,
    });
  });

  it('does not reuse an expired, disabled, or different users discount', () => {
    expect(
      resolveRegistrationTransferPrice({
        basePrice: 2500,
        cards: [
          {
            type: 'esnCard',
            validFrom: null,
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

  it('requires the card validity window to include the event start', () => {
    const eventStart = new Date('2026-09-01T18:00:00.000Z');
    const discounts = [
      { discountedPrice: 1500, discountType: 'esnCard' },
    ] as const;

    expect(
      resolveRegistrationTransferPrice({
        basePrice: 2500,
        cards: [
          {
            type: 'esnCard',
            validFrom: new Date('2026-09-02T00:00:00.000Z'),
            validTo: null,
          },
        ],
        discounts,
        enabledDiscountTypes: new Set(['esnCard']),
        eventStart,
      }).effectivePrice,
    ).toBe(2500);
    expect(
      resolveRegistrationTransferPrice({
        basePrice: 2500,
        cards: [
          {
            type: 'esnCard',
            validFrom: eventStart,
            validTo: new Date('2026-09-02T00:00:00.000Z'),
          },
        ],
        discounts,
        enabledDiscountTypes: new Set(['esnCard']),
        eventStart,
      }).effectivePrice,
    ).toBe(1500);
  });

  it.effect(
    'prices current guests and add-ons independently of the source purchase',
    () =>
      Effect.gen(function* () {
        expect(
          yield* registrationTransferTotalPrice({
            addOns: [{ quantity: 3, unitPrice: 300 }],
            effectivePrice: 1500,
            guestCount: 2,
            guestUnitPrice: 2500,
          }),
        ).toBe(7400);
      }),
  );

  it.effect(
    'rejects derived prices that cannot fit the transaction amount column',
    () =>
      Effect.gen(function* () {
        expect(
          yield* registrationTransferTotalPrice({
            addOns: [],
            effectivePrice: maximumPersistedPaymentAmount,
            guestCount: 0,
            guestUnitPrice: 0,
          }),
        ).toBe(maximumPersistedPaymentAmount);

        const error = yield* registrationTransferTotalPrice({
          addOns: [{ quantity: 2, unitPrice: maximumPersistedPaymentAmount }],
          effectivePrice: 0,
          guestCount: 0,
          guestUnitPrice: 0,
        }).pipe(Effect.flip);
        expect(error).toBeInstanceOf(RegistrationTransferPricingError);
        expect(error.message).toBe(
          'Registration transfer price exceeds supported payment limits',
        );
      }),
  );
});
