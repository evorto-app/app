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

const missingStripeAccount = () =>
  new RpcBadRequestError({
    message: 'The tenant does not have a connected Stripe account',
    reason: 'stripeAccountRequired',
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
    return yield* new RpcBadRequestError({
      message:
        'The tenant Stripe account changed while tax rates were being loaded; retry the import',
      reason: 'stripeAccountChanged',
    });
  }
});

export const stripeTaxRateAccountConflict = () =>
  new RpcBadRequestError({
    message: 'Imported tax-rate metadata belongs to a different Stripe account',
    reason: 'stripeTaxRateAccountConflict',
  });

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
      'The Stripe account has too many tax rates to list safely in one request',
    reason: 'stripeTaxRatePageLimitExceeded',
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
      error instanceof Stripe.errors.StripeInvalidRequestError
        ? Effect.fail(
            new RpcBadRequestError({
              message: `Stripe tax rate ${id} was not found for the connected tenant account`,
              reason: 'stripeTaxRateNotFound',
            }),
          )
        : Effect.die(error),
    ),
  );
  if (stripeRate.id !== id) {
    return yield* new RpcBadRequestError({
      message: `Stripe returned an unexpected tax rate for ${id}`,
      reason: 'stripeTaxRateIdentityMismatch',
    });
  }
  if (!stripeRate.active || !stripeRate.inclusive) {
    return yield* new RpcBadRequestError({
      message: `Stripe tax rate ${id} must be active and inclusive`,
      reason: 'unsupportedStripeTaxRate',
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
      message: 'Import between 1 and 100 Stripe tax rates at a time',
      reason: 'stripeTaxRateImportSizeInvalid',
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
