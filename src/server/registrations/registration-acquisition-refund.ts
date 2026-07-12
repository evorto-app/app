import {
  allocateCumulativeQuantityAmount,
  allocateIntegerByWeight,
} from '../payments/addon-payment-allocation';

export interface AcquisitionComponentQuantityAmounts {
  readonly applicationFeeAmount: number;
  readonly grossAmount: number;
  readonly netAmount: number;
  readonly stripeFeeAmount: number;
}

interface RefundableAcquisitionComponent extends AcquisitionComponentQuantityAmounts {
  readonly quantity: number;
}

/**
 * Allocates one immutable component across physical quantities without losing
 * the exact settled identity gross = net + Stripe fee + application fee.
 * `alreadyAllocatedQuantity` includes earlier physical cancellations even when
 * their cancellation policy produced no monetary refund.
 */
export const allocateAcquisitionComponentQuantity = (input: {
  readonly alreadyAllocatedQuantity: number;
  readonly component: RefundableAcquisitionComponent;
  readonly quantity: number;
}): AcquisitionComponentQuantityAmounts | undefined => {
  const { component } = input;
  const values = [
    input.alreadyAllocatedQuantity,
    input.quantity,
    component.applicationFeeAmount,
    component.grossAmount,
    component.netAmount,
    component.quantity,
    component.stripeFeeAmount,
  ];
  if (
    values.some((value) => !Number.isSafeInteger(value) || value < 0) ||
    component.quantity === 0 ||
    input.quantity === 0 ||
    input.alreadyAllocatedQuantity + input.quantity > component.quantity ||
    component.netAmount +
      component.stripeFeeAmount +
      component.applicationFeeAmount !==
      component.grossAmount
  ) {
    return;
  }

  const unitAmounts: AcquisitionComponentQuantityAmounts[] = [];
  let remaining = {
    applicationFeeAmount: component.applicationFeeAmount,
    grossAmount: component.grossAmount,
    netAmount: component.netAmount,
    stripeFeeAmount: component.stripeFeeAmount,
  };
  for (let unit = 0; unit < component.quantity; unit += 1) {
    const grossAmount = allocateCumulativeQuantityAmount({
      alreadyAllocatedQuantity: unit,
      amount: component.grossAmount,
      quantity: 1,
      totalQuantity: component.quantity,
    });
    const partitions = allocateIntegerByWeight(grossAmount, [
      {
        key: 'applicationFeeAmount',
        weight: remaining.applicationFeeAmount,
      },
      { key: 'netAmount', weight: remaining.netAmount },
      { key: 'stripeFeeAmount', weight: remaining.stripeFeeAmount },
    ]);
    const applicationFeeAmount = partitions.get('applicationFeeAmount') ?? 0;
    const netAmount = partitions.get('netAmount') ?? 0;
    const stripeFeeAmount = partitions.get('stripeFeeAmount') ?? 0;
    const unitAmount = {
      applicationFeeAmount,
      grossAmount,
      netAmount,
      stripeFeeAmount,
    };
    unitAmounts.push(unitAmount);
    remaining = {
      applicationFeeAmount:
        remaining.applicationFeeAmount - applicationFeeAmount,
      grossAmount: remaining.grossAmount - grossAmount,
      netAmount: remaining.netAmount - netAmount,
      stripeFeeAmount: remaining.stripeFeeAmount - stripeFeeAmount,
    };
  }
  if (Object.values(remaining).some((amount) => amount !== 0)) return;

  let applicationFeeAmount = 0;
  let grossAmount = 0;
  let netAmount = 0;
  let stripeFeeAmount = 0;
  for (const amount of unitAmounts.slice(
    input.alreadyAllocatedQuantity,
    input.alreadyAllocatedQuantity + input.quantity,
  )) {
    applicationFeeAmount += amount.applicationFeeAmount;
    grossAmount += amount.grossAmount;
    netAmount += amount.netAmount;
    stripeFeeAmount += amount.stripeFeeAmount;
  }
  return {
    applicationFeeAmount,
    grossAmount,
    netAmount,
    stripeFeeAmount,
  };
};
