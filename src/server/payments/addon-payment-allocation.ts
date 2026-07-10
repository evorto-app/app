import { Effect, Schema } from 'effect';

export interface AddonPaymentLotTerms {
  readonly baseAmount: number;
  readonly id: string;
  readonly quantity: number;
  readonly taxRateInclusive: boolean | null;
  readonly taxRatePercentage: null | string;
}

export interface FinalizedAddonPaymentAllocation {
  readonly applicationFeeAmount: number;
  readonly grossAmount: number;
  readonly id: string;
  readonly netAmount: number;
  readonly stripeFeeAmount: number;
  readonly taxAmount: number;
}

export class AddonPaymentAllocationError extends Schema.TaggedErrorClass<AddonPaymentAllocationError>()(
  'AddonPaymentAllocationError',
  { message: Schema.String },
) {}

const allocationError = (message: string) =>
  new AddonPaymentAllocationError({ message });

const roundFraction = (numerator: number, denominator: number): number =>
  Math.floor((numerator + Math.floor(denominator / 2)) / denominator);

const percentageRatio = (
  percentage: null | string,
): undefined | { denominator: number; numerator: number } => {
  if (percentage === null) return;
  const normalized = percentage.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) return;
  const [whole = '0', fraction = ''] = normalized.split('.');
  const denominator = 10 ** fraction.length;
  const numerator = Number(whole) * denominator + Number(fraction || '0');
  if (!Number.isSafeInteger(numerator) || numerator < 0) return;
  return { denominator, numerator };
};

const taxAllocation = (
  lot: AddonPaymentLotTerms,
): undefined | { expectedGrossAmount: number; taxAmount: number } => {
  const ratio = percentageRatio(lot.taxRatePercentage);
  if (!ratio) {
    return lot.taxRatePercentage === null && lot.taxRateInclusive === null
      ? { expectedGrossAmount: lot.baseAmount, taxAmount: 0 }
      : undefined;
  }
  if (lot.taxRateInclusive === null) return;
  if (lot.taxRateInclusive) {
    const taxAmount = roundFraction(
      lot.baseAmount * ratio.numerator,
      100 * ratio.denominator + ratio.numerator,
    );
    return { expectedGrossAmount: lot.baseAmount, taxAmount };
  }
  const taxAmount = roundFraction(
    lot.baseAmount * ratio.numerator,
    100 * ratio.denominator,
  );
  return {
    expectedGrossAmount: lot.baseAmount + taxAmount,
    taxAmount,
  };
};

export const allocateIntegerByWeight = (
  total: number,
  weightedKeys: readonly {
    readonly key: string;
    readonly weight: number;
  }[],
): ReadonlyMap<string, number> => {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError('Allocation total must be a nonnegative integer');
  }
  if (
    weightedKeys.some(
      ({ weight }) => !Number.isSafeInteger(weight) || weight < 0,
    )
  ) {
    throw new RangeError('Allocation weights must be nonnegative integers');
  }
  const positiveWeights = weightedKeys.filter(({ weight }) => weight > 0);
  const weightTotal = positiveWeights.reduce(
    (sum, allocation) => sum + allocation.weight,
    0,
  );
  if (weightTotal === 0) {
    if (total !== 0) throw new RangeError('A positive total needs a weight');
    return new Map(weightedKeys.map(({ key }) => [key, 0]));
  }

  const provisional = positiveWeights.map(({ key, weight }) => {
    const numerator = total * weight;
    return {
      key,
      remainder: numerator % weightTotal,
      value: Math.floor(numerator / weightTotal),
    };
  });
  let remainder =
    total - provisional.reduce((sum, allocation) => sum + allocation.value, 0);
  provisional.sort(
    (left, right) =>
      right.remainder - left.remainder || left.key.localeCompare(right.key),
  );
  for (const allocation of provisional) {
    if (remainder === 0) break;
    allocation.value += 1;
    remainder -= 1;
  }
  return new Map([
    ...weightedKeys
      .filter(({ weight }) => weight === 0)
      .map(({ key }) => [key, 0] as const),
    ...provisional.map(({ key, value }) => [key, value] as const),
  ]);
};

export const allocateCumulativeQuantityAmount = (input: {
  readonly alreadyAllocatedQuantity: number;
  readonly amount: number;
  readonly quantity: number;
  readonly totalQuantity: number;
}): number => {
  const values = [
    input.alreadyAllocatedQuantity,
    input.amount,
    input.quantity,
    input.totalQuantity,
  ];
  if (values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw new RangeError('Cumulative allocation inputs must be integers');
  }
  if (
    input.totalQuantity === 0 ||
    input.alreadyAllocatedQuantity + input.quantity > input.totalQuantity
  ) {
    throw new RangeError(
      'Cumulative allocation exceeds the purchased quantity',
    );
  }
  const after = roundFraction(
    input.amount * (input.alreadyAllocatedQuantity + input.quantity),
    input.totalQuantity,
  );
  const before = roundFraction(
    input.amount * input.alreadyAllocatedQuantity,
    input.totalQuantity,
  );
  return after - before;
};

export const finalizeAddonPaymentAllocations = Effect.fn(
  'finalizeAddonPaymentAllocations',
)(function* (input: {
  readonly applicationFee: number;
  readonly grossAmount: number;
  readonly includesRegistrationCharge: boolean;
  readonly lots: readonly AddonPaymentLotTerms[];
  readonly stripeFee: number;
}) {
  if (
    !Number.isSafeInteger(input.grossAmount) ||
    input.grossAmount <= 0 ||
    !Number.isSafeInteger(input.applicationFee) ||
    input.applicationFee < 0 ||
    !Number.isSafeInteger(input.stripeFee) ||
    input.stripeFee < 0 ||
    input.applicationFee + input.stripeFee > input.grossAmount
  ) {
    return yield* allocationError('Source payment amounts are inconsistent');
  }
  if (new Set(input.lots.map(({ id }) => id)).size !== input.lots.length) {
    return yield* allocationError('Purchase lot identifiers must be unique');
  }

  const expectedLots = [] as {
    expectedGrossAmount: number;
    id: string;
    taxAmount: number;
  }[];
  for (const lot of input.lots) {
    if (
      !lot.id.trim() ||
      !Number.isSafeInteger(lot.baseAmount) ||
      lot.baseAmount <= 0 ||
      !Number.isSafeInteger(lot.quantity) ||
      lot.quantity <= 0
    ) {
      return yield* allocationError('Purchase lot terms are invalid');
    }
    const tax = taxAllocation(lot);
    if (!tax) {
      return yield* allocationError('Purchase lot tax terms are invalid');
    }
    expectedLots.push({ id: lot.id, ...tax });
  }

  const expectedAddonGross = expectedLots.reduce(
    (sum, lot) => sum + lot.expectedGrossAmount,
    0,
  );
  if (expectedAddonGross > input.grossAmount) {
    return yield* allocationError(
      'Add-on line amounts exceed the successful source payment',
    );
  }

  const registrationKey = '__registration__';
  let grossByKey: ReadonlyMap<string, number>;
  if (input.includesRegistrationCharge) {
    grossByKey = new Map([
      ...expectedLots.map((lot) => [lot.id, lot.expectedGrossAmount] as const),
      [registrationKey, input.grossAmount - expectedAddonGross],
    ]);
  } else {
    if (expectedLots.length === 0) {
      return yield* allocationError('Add-on payment has no purchase lots');
    }
    try {
      grossByKey = allocateIntegerByWeight(
        input.grossAmount,
        expectedLots.map((lot) => ({
          key: lot.id,
          weight: lot.expectedGrossAmount,
        })),
      );
    } catch {
      return yield* allocationError('Add-on gross allocation failed');
    }
  }

  const grossWeights = [...grossByKey].map(([key, weight]) => ({
    key,
    weight,
  }));
  let applicationFeeByKey: ReadonlyMap<string, number>;
  let stripeFeeByKey: ReadonlyMap<string, number>;
  try {
    applicationFeeByKey = allocateIntegerByWeight(
      input.applicationFee,
      grossWeights,
    );
    stripeFeeByKey = allocateIntegerByWeight(input.stripeFee, grossWeights);
  } catch {
    return yield* allocationError('Source fee allocation failed');
  }

  const finalized = expectedLots.map((lot) => {
    const grossAmount = grossByKey.get(lot.id) ?? 0;
    const applicationFeeAmount = applicationFeeByKey.get(lot.id) ?? 0;
    const stripeFeeAmount = stripeFeeByKey.get(lot.id) ?? 0;
    return {
      applicationFeeAmount,
      grossAmount,
      id: lot.id,
      netAmount: grossAmount - applicationFeeAmount - stripeFeeAmount,
      stripeFeeAmount,
      taxAmount:
        input.includesRegistrationCharge ||
        grossAmount === lot.expectedGrossAmount
          ? lot.taxAmount
          : Math.max(
              0,
              grossAmount - (lot.expectedGrossAmount - lot.taxAmount),
            ),
    } satisfies FinalizedAddonPaymentAllocation;
  });
  if (finalized.some(({ netAmount }) => netAmount < 0)) {
    return yield* allocationError(
      'Allocated source fees exceed an add-on line',
    );
  }
  return finalized;
});
