import { describe, expect, it } from '@effect/vitest';

import {
  type AcquisitionComponentQuantityAmounts,
  allocateAcquisitionComponentQuantity,
} from './registration-acquisition-refund';

const sumAmounts = (
  amounts: readonly AcquisitionComponentQuantityAmounts[],
): AcquisitionComponentQuantityAmounts => {
  const total = {
    applicationFeeAmount: 0,
    grossAmount: 0,
    netAmount: 0,
    stripeFeeAmount: 0,
  };
  for (const amount of amounts) {
    total.applicationFeeAmount += amount.applicationFeeAmount;
    total.grossAmount += amount.grossAmount;
    total.netAmount += amount.netAmount;
    total.stripeFeeAmount += amount.stripeFeeAmount;
  }
  return total;
};

const requireAllocation = (
  allocation: AcquisitionComponentQuantityAmounts | undefined,
) => {
  expect(allocation).toBeDefined();
  if (!allocation) {
    throw new Error('Expected acquisition component allocation');
  }
  return allocation;
};

describe('allocateAcquisitionComponentQuantity', () => {
  it('partitions every settled amount exactly across all physical slices', () => {
    const component = {
      applicationFeeAmount: 2,
      grossAmount: 17,
      netAmount: 11,
      quantity: 5,
      stripeFeeAmount: 4,
    };

    const slices = Array.from({ length: component.quantity }, (_, index) =>
      requireAllocation(
        allocateAcquisitionComponentQuantity({
          alreadyAllocatedQuantity: index,
          component,
          quantity: 1,
        }),
      ),
    );

    for (const slice of slices) {
      expect(slice.grossAmount).toBe(
        slice.netAmount + slice.stripeFeeAmount + slice.applicationFeeAmount,
      );
    }
    expect(sumAmounts(slices)).toEqual({
      applicationFeeAmount: component.applicationFeeAmount,
      grossAmount: component.grossAmount,
      netAmount: component.netAmount,
      stripeFeeAmount: component.stripeFeeAmount,
    });
  });

  it('allocates cumulative partial cancellations deterministically, including a zero-cent slice', () => {
    const component = {
      applicationFeeAmount: 0,
      grossAmount: 3,
      netAmount: 2,
      quantity: 4,
      stripeFeeAmount: 1,
    };

    const firstTwo = requireAllocation(
      allocateAcquisitionComponentQuantity({
        alreadyAllocatedQuantity: 0,
        component,
        quantity: 2,
      }),
    );
    const zeroCentThird = requireAllocation(
      allocateAcquisitionComponentQuantity({
        alreadyAllocatedQuantity: 2,
        component,
        quantity: 1,
      }),
    );
    const final = requireAllocation(
      allocateAcquisitionComponentQuantity({
        alreadyAllocatedQuantity: 3,
        component,
        quantity: 1,
      }),
    );

    expect(firstTwo).toEqual({
      applicationFeeAmount: 0,
      grossAmount: 2,
      netAmount: 2,
      stripeFeeAmount: 0,
    });
    expect(zeroCentThird).toEqual({
      applicationFeeAmount: 0,
      grossAmount: 0,
      netAmount: 0,
      stripeFeeAmount: 0,
    });
    expect(final).toEqual({
      applicationFeeAmount: 0,
      grossAmount: 1,
      netAmount: 0,
      stripeFeeAmount: 1,
    });
    expect(sumAmounts([firstTwo, zeroCentThird, final])).toEqual({
      applicationFeeAmount: component.applicationFeeAmount,
      grossAmount: component.grossAmount,
      netAmount: component.netAmount,
      stripeFeeAmount: component.stripeFeeAmount,
    });

    expect(
      allocateAcquisitionComponentQuantity({
        alreadyAllocatedQuantity: 0,
        component,
        quantity: 3,
      }),
    ).toEqual(sumAmounts([firstTwo, zeroCentThird]));
    expect(
      allocateAcquisitionComponentQuantity({
        alreadyAllocatedQuantity: 2,
        component,
        quantity: 2,
      }),
    ).toEqual(sumAmounts([zeroCentThird, final]));
  });

  it('rejects invalid quantity bounds and unsettled component amounts', () => {
    const validComponent = {
      applicationFeeAmount: 1,
      grossAmount: 10,
      netAmount: 7,
      quantity: 4,
      stripeFeeAmount: 2,
    };
    const invalidInputs = [
      {
        alreadyAllocatedQuantity: 0,
        component: validComponent,
        quantity: 0,
      },
      {
        alreadyAllocatedQuantity: 4,
        component: validComponent,
        quantity: 1,
      },
      {
        alreadyAllocatedQuantity: -1,
        component: validComponent,
        quantity: 1,
      },
      {
        alreadyAllocatedQuantity: 0,
        component: { ...validComponent, quantity: 0 },
        quantity: 1,
      },
      {
        alreadyAllocatedQuantity: 0,
        component: { ...validComponent, netAmount: 6 },
        quantity: 1,
      },
      {
        alreadyAllocatedQuantity: 0,
        component: { ...validComponent, stripeFeeAmount: -1 },
        quantity: 1,
      },
      {
        alreadyAllocatedQuantity: 0,
        component: validComponent,
        quantity: 1.5,
      },
      {
        alreadyAllocatedQuantity: 0,
        component: {
          ...validComponent,
          grossAmount: Number.MAX_SAFE_INTEGER + 1,
        },
        quantity: 1,
      },
    ] satisfies Parameters<typeof allocateAcquisitionComponentQuantity>[0][];

    for (const input of invalidInputs) {
      expect(allocateAcquisitionComponentQuantity(input)).toBeUndefined();
    }
  });
});
