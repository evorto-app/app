import { RpcBadRequestError } from '@shared/errors/rpc-errors';
import { Effect } from 'effect';
import Stripe from 'stripe';

export const STRIPE_TAX_RATE_IMPORT_CONCURRENCY = 10;
export const STRIPE_TAX_RATE_IMPORT_MAX_IDS = 100;
export const STRIPE_TAX_RATE_MAX_PAGES = 20;
export const STRIPE_TAX_RATE_PAGE_SIZE = 100;

export interface StripeTaxRateApi {
  readonly list: (
    parameters: StripeTaxRateListParameters,
    options: StripeTaxRateRequestOptions,
  ) => PromiseLike<StripeTaxRatePage>;
  readonly retrieve: (
    id: string,
    parameters: undefined,
    options: StripeTaxRateRequestOptions,
  ) => PromiseLike<StripeTaxRateSource>;
}

export interface StripeTaxRateSource {
  readonly active: boolean;
  readonly country: null | string;
  readonly display_name: null | string;
  readonly id: string;
  readonly inclusive: boolean;
  readonly percentage: null | number;
  readonly state: null | string;
}

interface StripeTaxRateListFilters {
  readonly active?: boolean;
  readonly inclusive?: boolean;
}

interface StripeTaxRateListParameters {
  readonly active?: boolean;
  readonly inclusive?: boolean;
  readonly limit: 100;
  readonly starting_after?: string;
}

interface StripeTaxRatePage {
  readonly data: readonly StripeTaxRateSource[];
  readonly has_more: boolean;
}

interface StripeTaxRateRequestOptions {
  readonly stripeAccount: string;
}

const isDefinitiveMissingStripeTaxRate = (
  error: unknown,
): error is Stripe.errors.StripeInvalidRequestError =>
  error instanceof Stripe.errors.StripeInvalidRequestError &&
  error.statusCode === 404 &&
  error.code === 'resource_missing';

const missingStripeAccount = () =>
  new RpcBadRequestError({
    message: 'Paid sign-ups are not ready for this organization.',
    reason: 'Contact Evorto support before adding tax rates, then try again.',
  });

export const requireTenantStripeAccount = Effect.fn(
  'StripeTaxRates.requireTenantStripeAccount',
)(function* (stripeAccountId: null | string) {
  if (!stripeAccountId) {
    return yield* missingStripeAccount();
  }

  return stripeAccountId;
});

export const ensureStripeAccountUnchanged = Effect.fn(
  'StripeTaxRates.ensureStripeAccountUnchanged',
)(function* (
  expectedStripeAccountId: string,
  lockedStripeAccountId: null | string,
) {
  if (lockedStripeAccountId !== expectedStripeAccountId) {
    return yield* Effect.die(
      new Error('Tenant Stripe account changed during tax-rate import'),
    );
  }
});

export const stripeTaxRateAccountConflict = () =>
  Effect.die(
    new Error('Stored tax-rate account does not match the tenant account'),
  );

const pageMatchesFilters = (
  rate: StripeTaxRateSource,
  filters: StripeTaxRateListFilters,
) =>
  (filters.active === undefined || rate.active === filters.active) &&
  (filters.inclusive === undefined || rate.inclusive === filters.inclusive);

export const collectStripeTaxRatePages = Effect.fn(
  'StripeTaxRates.collectStripeTaxRatePages',
)(function* <E, R>(
  loadPage: (
    startingAfter: string | undefined,
  ) => Effect.Effect<StripeTaxRatePage, E, R>,
  maxPages = STRIPE_TAX_RATE_MAX_PAGES,
) {
  const rates: StripeTaxRateSource[] = [];
  let startingAfter: string | undefined;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = yield* loadPage(startingAfter);
    rates.push(...page.data);
    if (!page.has_more) {
      return rates;
    }

    const lastRate = page.data.at(-1);
    if (!lastRate) {
      return yield* Effect.die(
        new Error('Stripe returned an empty tax-rate page with has_more=true'),
      );
    }
    startingAfter = lastRate.id;
  }

  return yield* new RpcBadRequestError({
    message:
      'There are too many tax rates to load at once. Archive tax rates you no longer use, then try again.',
    reason: 'taxRatePageLimitExceeded',
  });
});

export const listStripeTaxRates = Effect.fn(
  'StripeTaxRates.listStripeTaxRates',
)(function* (
  stripeTaxRates: StripeTaxRateApi,
  stripeAccount: string,
  filters: StripeTaxRateListFilters,
  maxPages = STRIPE_TAX_RATE_MAX_PAGES,
) {
  const rates = yield* collectStripeTaxRatePages(
    (startingAfter) =>
      Effect.tryPromise({
        catch: (error) => error,
        try: () =>
          stripeTaxRates.list(
            {
              ...filters,
              limit: STRIPE_TAX_RATE_PAGE_SIZE,
              ...(startingAfter !== undefined && {
                starting_after: startingAfter,
              }),
            },
            { stripeAccount },
          ),
      }).pipe(
        Effect.orDie,
        Effect.map((page) => ({
          data: page.data,
          has_more: page.has_more,
        })),
      ),
    maxPages,
  );

  return rates.filter((rate) => pageMatchesFilters(rate, filters));
});

const retrieveSupportedStripeTaxRate = Effect.fn(
  'StripeTaxRates.retrieveSupportedStripeTaxRate',
)(function* (
  stripeTaxRates: StripeTaxRateApi,
  stripeAccount: string,
  id: string,
) {
  const stripeRate = yield* Effect.tryPromise({
    catch: (error) => error,
    try: () => stripeTaxRates.retrieve(id, undefined, { stripeAccount }),
  }).pipe(
    Effect.catch((error) =>
      isDefinitiveMissingStripeTaxRate(error)
        ? Effect.fail(
            new RpcBadRequestError({
              message:
                'A selected tax rate is no longer available. No tax rates were added. Select the tax rates again, then choose Add selected.',
              reason: 'taxRateUnavailable',
            }),
          )
        : Effect.die(error),
    ),
  );
  if (stripeRate.id !== id) {
    return yield* Effect.die(
      new Error('Stripe returned a tax rate with an unexpected ID'),
    );
  }
  if (!stripeRate.active || !stripeRate.inclusive) {
    return yield* new RpcBadRequestError({
      message:
        'A selected tax rate cannot be used for shown prices. Choose an active tax rate that is included in the shown price.',
      reason: 'taxRateNotUsable',
    });
  }

  return stripeRate;
});

export const loadStripeTaxRatesForImport = Effect.fn(
  'StripeTaxRates.loadStripeTaxRatesForImport',
)(function* (
  stripeTaxRates: StripeTaxRateApi,
  stripeAccount: string,
  requestedIds: readonly string[],
) {
  if (
    requestedIds.length === 0 ||
    requestedIds.length > STRIPE_TAX_RATE_IMPORT_MAX_IDS
  ) {
    return yield* new RpcBadRequestError({
      message: 'Choose between 1 and 100 tax rates to add.',
    });
  }

  const ids = [...new Set(requestedIds)].toSorted();
  const rates = yield* Effect.forEach(
    ids,
    (id) => retrieveSupportedStripeTaxRate(stripeTaxRates, stripeAccount, id),
    { concurrency: STRIPE_TAX_RATE_IMPORT_CONCURRENCY },
  );

  return { ids, rates };
});

export const toTenantStripeTaxRateValues = (
  stripeRate: StripeTaxRateSource,
  input: {
    readonly stripeAccountId: string;
    readonly tenantId: string;
  },
) => ({
  active: stripeRate.active,
  country: stripeRate.country ?? null,
  displayName: stripeRate.display_name ?? null,
  inclusive: stripeRate.inclusive,
  percentage:
    stripeRate.percentage === null ? null : String(stripeRate.percentage),
  state: stripeRate.state ?? null,
  stripeAccountId: input.stripeAccountId,
  stripeTaxRateId: stripeRate.id,
  tenantId: input.tenantId,
});
