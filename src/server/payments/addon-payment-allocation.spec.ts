import { Effect } from 'effect';
import { describe, expect, it } from 'vitest';

import {
  allocateCumulativeQuantityAmount,
  allocateIntegerByWeight,
  finalizeAddonPaymentAllocations,
} from './addon-payment-allocation';
import { maximumPersistedPaymentAmount } from './payment-amount';

describe('add-on payment allocation', () => {
  it('uses stable largest remainders and preserves the exact total', () => {
    expect(
      Object.fromEntries(
        allocateIntegerByWeight(10, [
          { key: 'b', weight: 1 },
          { key: 'a', weight: 1 },
          { key: 'c', weight: 1 },
        ]),
      ),
    ).toEqual({ a: 4, b: 3, c: 3 });
  });

  it('allocates exactly when intermediate products exceed safe-number precision', () => {
    expect(
      Object.fromEntries(
        allocateIntegerByWeight(maximumPersistedPaymentAmount, [
          { key: 'large', weight: maximumPersistedPaymentAmount - 1 },
          { key: 'small', weight: 1 },
        ]),
      ),
    ).toEqual({ large: maximumPersistedPaymentAmount - 1, small: 1 });

    expect(
      allocateCumulativeQuantityAmount({
        alreadyAllocatedQuantity: maximumPersistedPaymentAmount - 1,
        amount: maximumPersistedPaymentAmount,
        quantity: 1,
        totalQuantity: maximumPersistedPaymentAmount,
      }),
    ).toBe(1);
  });

  it('rejects values and derived weight totals outside persisted payment bounds', () => {
    expect(() =>
      allocateIntegerByWeight(maximumPersistedPaymentAmount + 1, [
        { key: 'only', weight: 1 },
      ]),
    ).toThrow(RangeError);
    expect(() =>
      allocateIntegerByWeight(10, [
        { key: 'a', weight: maximumPersistedPaymentAmount },
        { key: 'b', weight: 1 },
      ]),
    ).toThrow('Allocation weight total exceeds the payment limit');
  });

  it('persists exact gross, tax, Stripe fee, app fee and net shares', async () => {
    const result = await Effect.runPromise(
      finalizeAddonPaymentAllocations({
        applicationFee: 105,
        grossAmount: 3500,
        includesRegistrationCharge: true,
        lots: [
          {
            baseAmount: 1000,
            id: 'inclusive',
            quantity: 2,
            taxRateInclusive: true,
            taxRatePercentage: '20',
          },
          {
            baseAmount: 500,
            id: 'exclusive',
            quantity: 1,
            taxRateInclusive: false,
            taxRatePercentage: '20',
          },
        ],
        stripeFee: 70,
      }),
    );

    expect(result).toEqual([
      {
        applicationFeeAmount: 30,
        grossAmount: 1000,
        id: 'inclusive',
        netAmount: 950,
        stripeFeeAmount: 20,
        taxAmount: 167,
      },
      {
        applicationFeeAmount: 18,
        grossAmount: 600,
        id: 'exclusive',
        netAmount: 570,
        stripeFeeAmount: 12,
        taxAmount: 100,
      },
    ]);
    expect(
      result.reduce((sum, allocation) => sum + allocation.grossAmount, 0),
    ).toBe(1600);
  });

  it('makes repeated partial refunds plus the final cancellation exact', () => {
    const gross = [1, 1, 1].map((quantity, index) =>
      allocateCumulativeQuantityAmount({
        alreadyAllocatedQuantity: index,
        amount: 1000,
        quantity,
        totalQuantity: 3,
      }),
    );
    const net = [1, 1, 1].map((quantity, index) =>
      allocateCumulativeQuantityAmount({
        alreadyAllocatedQuantity: index,
        amount: 913,
        quantity,
        totalQuantity: 3,
      }),
    );
    const appFee = [1, 1, 1].map((quantity, index) =>
      allocateCumulativeQuantityAmount({
        alreadyAllocatedQuantity: index,
        amount: 35,
        quantity,
        totalQuantity: 3,
      }),
    );

    expect(gross).toEqual([333, 334, 333]);
    expect(net).toEqual([304, 305, 304]);
    expect(appFee).toEqual([12, 11, 12]);
    expect(gross.reduce((sum, amount) => sum + amount, 0)).toBe(1000);
    expect(net.reduce((sum, amount) => sum + amount, 0)).toBe(913);
    expect(appFee.reduce((sum, amount) => sum + amount, 0)).toBe(35);
  });
});
