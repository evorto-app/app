export interface LegacyRegistrationPricing {
  readonly basePriceInCents: number;
  readonly esnCardDiscountedPriceInCents: null | number;
  readonly isPaid: boolean;
}

const POSTGRES_INTEGER_MAX = 2_147_483_647;

interface LegacyPriceOption {
  readonly allowedStatusList: readonly string[];
  readonly amountInCents: number;
  readonly defaultPrice: boolean;
  readonly esnCardRequired: boolean;
}

type LegacyRegistrationMode = 'EXTERNAL' | 'ONLINE' | 'STRIPE';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const priceCents = (
  value: unknown,
  context: string,
  allowZero: boolean,
): number => {
  const normalizedString = typeof value === 'string' ? value.trim() : null;
  if (
    normalizedString !== null &&
    !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(normalizedString)
  ) {
    throw new Error(
      `${context} must be a positive default or nonnegative alternative amount with at most two decimal places.`,
    );
  }
  const amount =
    typeof value === 'number'
      ? value
      : normalizedString === null
        ? Number.NaN
        : Number(normalizedString);
  const rawCents = amount * 100;
  const cents = Math.round(rawCents);
  const roundingTolerance =
    Number.EPSILON * Math.max(1, Math.abs(rawCents)) * 4;
  if (
    !Number.isFinite(amount) ||
    !Number.isSafeInteger(cents) ||
    cents > POSTGRES_INTEGER_MAX ||
    (allowZero ? cents < 0 : cents <= 0) ||
    Math.abs(rawCents - cents) > roundingTolerance
  ) {
    throw new Error(
      `${context} must be a positive default or nonnegative alternative amount with at most two decimal places.`,
    );
  }
  return cents;
};

const decodePriceOption = (
  value: unknown,
  index: number,
): LegacyPriceOption => {
  const context = `Legacy price option ${index + 1}`;
  if (
    !isRecord(value) ||
    typeof value['defaultPrice'] !== 'boolean' ||
    typeof value['esnCardRequired'] !== 'boolean' ||
    !Array.isArray(value['allowedStatusList']) ||
    !value['allowedStatusList'].every(
      (status): status is string => typeof status === 'string',
    )
  ) {
    throw new Error(`${context} has an invalid shape.`);
  }
  return {
    allowedStatusList: value['allowedStatusList'],
    amountInCents: priceCents(
      value['amount'],
      `${context} amount`,
      value['defaultPrice'] === false,
    ),
    defaultPrice: value['defaultPrice'],
    esnCardRequired: value['esnCardRequired'],
  };
};

export const legacyRegistrationPricing = (
  registrationMode: LegacyRegistrationMode,
  prices: unknown,
  eligibleStatuses: readonly string[],
): LegacyRegistrationPricing => {
  if (registrationMode === 'EXTERNAL') {
    throw new Error(
      'Legacy external registration has no target representation; migration is blocked.',
    );
  }
  if (registrationMode === 'ONLINE') {
    return {
      basePriceInCents: 0,
      esnCardDiscountedPriceInCents: null,
      isPaid: false,
    };
  }
  if (!isRecord(prices) || !Array.isArray(prices['options'])) {
    throw new Error(
      'Legacy Stripe registration has no valid price options; migration is blocked.',
    );
  }

  const options = prices['options'].map(decodePriceOption);
  const defaultOptions = options.filter(({ defaultPrice }) => defaultPrice);
  if (defaultOptions.length !== 1) {
    throw new Error(
      `Legacy Stripe registration must have exactly one default price, found ${defaultOptions.length}; migration is blocked.`,
    );
  }
  const defaultOption = defaultOptions[0];
  if (!defaultOption || defaultOption.esnCardRequired) {
    throw new Error(
      'Legacy Stripe default price cannot require an ESNcard; migration is blocked.',
    );
  }
  if (
    eligibleStatuses.some(
      (status) => !defaultOption.allowedStatusList.includes(status),
    )
  ) {
    throw new Error(
      'Legacy default pricing is restricted to a subset of eligible participants and has no target representation; migration is blocked.',
    );
  }

  const alternativeOptions = options.filter(
    ({ defaultPrice }) => !defaultPrice,
  );
  const membershipOnlyOption = alternativeOptions.find(
    ({ esnCardRequired }) => !esnCardRequired,
  );
  if (membershipOnlyOption) {
    throw new Error(
      'Legacy membership-only pricing has no target representation; migration is blocked.',
    );
  }
  const esnCardOptions = alternativeOptions.filter(
    ({ esnCardRequired }) => esnCardRequired,
  );
  if (esnCardOptions.length > 1) {
    throw new Error(
      'Multiple legacy ESNcard prices have no unambiguous target representation; migration is blocked.',
    );
  }
  const esnCardOption = esnCardOptions[0];
  const esnCardDiscountedPriceInCents = esnCardOption?.amountInCents ?? null;
  if (
    esnCardOption &&
    eligibleStatuses.some(
      (status) => !esnCardOption.allowedStatusList.includes(status),
    )
  ) {
    throw new Error(
      'Legacy ESNcard pricing is restricted to a subset of eligible participants and has no target representation; migration is blocked.',
    );
  }
  if (
    esnCardDiscountedPriceInCents !== null &&
    esnCardDiscountedPriceInCents > defaultOption.amountInCents
  ) {
    throw new Error(
      'Legacy ESNcard price exceeds the default price; migration is blocked.',
    );
  }

  return {
    basePriceInCents: defaultOption.amountInCents,
    esnCardDiscountedPriceInCents,
    isPaid: true,
  };
};
