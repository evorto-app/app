import {
  isPersistableNonNegativeInteger,
  maximumPersistedPaymentAmount,
} from './payment-amount';

const roundFraction = (numerator: bigint, denominator: bigint): number =>
  Number((numerator + denominator / 2n) / denominator);

const percentageRatio = (
  percentage: null | string,
): undefined | { denominator: number; numerator: number } => {
  if (percentage === null) return;
  const normalized = percentage.trim();
  if (!/^\d+(?:\.\d{1,4})?$/.test(normalized)) return;
  const [whole = '0', fraction = ''] = normalized.split('.', 2);
  const denominator = 10 ** fraction.length;
  const numerator = Number(whole) * denominator + Number(fraction || '0');
  if (!Number.isSafeInteger(numerator) || numerator < 0) return;
  return { denominator, numerator };
};

export const resolveAddonTaxAmounts = (input: {
  readonly baseAmount: number;
  readonly taxRateInclusive: boolean | null;
  readonly taxRatePercentage: null | string;
}): undefined | { expectedGrossAmount: number; taxAmount: number } => {
  if (!isPersistableNonNegativeInteger(input.baseAmount)) return;
  const ratio = percentageRatio(input.taxRatePercentage);
  if (!ratio) {
    return input.taxRatePercentage === null && input.taxRateInclusive === null
      ? { expectedGrossAmount: input.baseAmount, taxAmount: 0 }
      : undefined;
  }
  if (input.taxRateInclusive === null) return;
  const taxNumerator = BigInt(input.baseAmount) * BigInt(ratio.numerator);
  if (input.taxRateInclusive) {
    const taxAmount = roundFraction(
      taxNumerator,
      100n * BigInt(ratio.denominator) + BigInt(ratio.numerator),
    );
    return { expectedGrossAmount: input.baseAmount, taxAmount };
  }
  const taxAmount = roundFraction(
    taxNumerator,
    100n * BigInt(ratio.denominator),
  );
  const expectedGrossAmount = input.baseAmount + taxAmount;
  if (!isPersistableNonNegativeInteger(expectedGrossAmount)) return;
  return {
    expectedGrossAmount,
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
  if (!isPersistableNonNegativeInteger(total)) {
    throw new RangeError('Allocation total must be a nonnegative integer');
  }
  if (
    weightedKeys.some(({ weight }) => !isPersistableNonNegativeInteger(weight))
  ) {
    throw new RangeError('Allocation weights must be nonnegative integers');
  }
  const positiveWeights = weightedKeys.filter(({ weight }) => weight > 0);
  const weightTotal = positiveWeights.reduce(
    (sum, allocation) => sum + BigInt(allocation.weight),
    0n,
  );
  if (weightTotal === 0n) {
    if (total !== 0) throw new RangeError('A positive total needs a weight');
    return new Map(weightedKeys.map(({ key }) => [key, 0]));
  }
  if (weightTotal > BigInt(maximumPersistedPaymentAmount)) {
    throw new RangeError('Allocation weight total exceeds the payment limit');
  }

  const provisional = positiveWeights.map(({ key, weight }) => {
    const numerator = BigInt(total) * BigInt(weight);
    return {
      key,
      remainder: numerator % weightTotal,
      value: Number(numerator / weightTotal),
    };
  });
  let remainder =
    total - provisional.reduce((sum, allocation) => sum + allocation.value, 0);
  provisional.sort(
    (left, right) =>
      (left.remainder === right.remainder
        ? 0
        : left.remainder > right.remainder
          ? -1
          : 1) || left.key.localeCompare(right.key),
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
  if (values.some((value) => !isPersistableNonNegativeInteger(value))) {
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
    BigInt(input.amount) *
      BigInt(input.alreadyAllocatedQuantity + input.quantity),
    BigInt(input.totalQuantity),
  );
  const before = roundFraction(
    BigInt(input.amount) * BigInt(input.alreadyAllocatedQuantity),
    BigInt(input.totalQuantity),
  );
  return after - before;
};
