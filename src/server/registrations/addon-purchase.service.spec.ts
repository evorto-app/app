import { describe, expect, it } from '@effect/vitest';

import {
  registrationAddonPurchaseCapacity,
  resolveRegistrationAddonPurchaseAmounts,
  resolveRegistrationAddonPurchaseWindow,
} from './addon-purchase.service';

describe('registration add-on purchase policy', () => {
  const start = new Date('2026-08-01T18:00:00.000Z');
  const end = new Date('2026-08-01T22:00:00.000Z');

  it('uses an exclusive start boundary for before-event purchases', () => {
    expect(
      resolveRegistrationAddonPurchaseWindow({
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: false,
        end,
        now: new Date('2026-08-01T17:59:59.999Z'),
        start,
      }),
    ).toBe('before_event');
    expect(
      resolveRegistrationAddonPurchaseWindow({
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: true,
        end,
        now: start,
        start,
      }),
    ).toBe('during_event');
  });

  it('keeps the end boundary closed and respects each configured window', () => {
    expect(
      resolveRegistrationAddonPurchaseWindow({
        allowPurchaseBeforeEvent: false,
        allowPurchaseDuringEvent: true,
        end,
        now: new Date('2026-08-01T17:59:59.999Z'),
        start,
      }),
    ).toBeUndefined();
    expect(
      resolveRegistrationAddonPurchaseWindow({
        allowPurchaseBeforeEvent: true,
        allowPurchaseDuringEvent: true,
        end,
        now: end,
        start,
      }),
    ).toBeUndefined();
  });

  it('counts settled and pending optional units but not included units', () => {
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: true,
        maxQuantityPerUser: 5,
        optionalPurchaseQuantity: 3,
        pendingOptionalQuantity: 1,
        purchasedOptionalQuantity: 1,
        requestedQuantity: 1,
        stock: 1,
      }),
    ).toBe('available');
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: true,
        maxQuantityPerUser: 5,
        optionalPurchaseQuantity: 3,
        pendingOptionalQuantity: 1,
        purchasedOptionalQuantity: 1,
        requestedQuantity: 2,
        stock: 2,
      }),
    ).toBe('option_limit_exceeded');
  });

  it('enforces lifetime single-unit, per-user, and stock limits', () => {
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: false,
        maxQuantityPerUser: 5,
        optionalPurchaseQuantity: 5,
        pendingOptionalQuantity: 0,
        purchasedOptionalQuantity: 1,
        requestedQuantity: 1,
        stock: 10,
      }),
    ).toBe('multiple_not_allowed');
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: true,
        maxQuantityPerUser: 2,
        optionalPurchaseQuantity: 5,
        pendingOptionalQuantity: 0,
        purchasedOptionalQuantity: 2,
        requestedQuantity: 1,
        stock: 10,
      }),
    ).toBe('user_limit_exceeded');
    expect(
      registrationAddonPurchaseCapacity({
        allowMultiple: true,
        maxQuantityPerUser: 5,
        optionalPurchaseQuantity: 5,
        pendingOptionalQuantity: 0,
        purchasedOptionalQuantity: 0,
        requestedQuantity: 2,
        stock: 1,
      }),
    ).toBe('out_of_stock');
  });

  it('derives exact no-tax and Stripe tax amounts before reserving stock', () => {
    expect(
      resolveRegistrationAddonPurchaseAmounts({
        quantity: 2,
        taxRateInclusive: null,
        taxRatePercentage: null,
        unitPrice: 100,
      }),
    ).toEqual({
      applicationFeeAmount: 7,
      baseAmount: 200,
      expectedGrossAmount: 200,
      taxAmount: 0,
    });
    expect(
      resolveRegistrationAddonPurchaseAmounts({
        quantity: 2,
        taxRateInclusive: false,
        taxRatePercentage: '19',
        unitPrice: 100,
      }),
    ).toEqual({
      applicationFeeAmount: 8,
      baseAmount: 200,
      expectedGrossAmount: 238,
      taxAmount: 38,
    });
    expect(
      resolveRegistrationAddonPurchaseAmounts({
        quantity: 2,
        taxRateInclusive: true,
        taxRatePercentage: '19',
        unitPrice: 100,
      }),
    ).toEqual({
      applicationFeeAmount: 7,
      baseAmount: 200,
      expectedGrossAmount: 200,
      taxAmount: 32,
    });
  });

  it('rejects unsafe quantities and incomplete tax snapshots', () => {
    expect(
      resolveRegistrationAddonPurchaseAmounts({
        quantity: 0,
        taxRateInclusive: null,
        taxRatePercentage: null,
        unitPrice: 100,
      }),
    ).toBeUndefined();
    expect(
      resolveRegistrationAddonPurchaseAmounts({
        quantity: 1,
        taxRateInclusive: null,
        taxRatePercentage: '19',
        unitPrice: 100,
      }),
    ).toBeUndefined();
  });
});
