import { describe, expect, it } from '@effect/vitest';
import { Effect } from 'effect';
import Stripe from 'stripe';

import {
  collectStripeTaxRatePages,
  listStripeTaxRates,
  loadStripeTaxRatesForImport,
  type StripeTaxRateApi,
  type StripeTaxRateSource,
} from './stripe-tax-rate.service';

const stripeRate = (
  id: string,
  overrides: Partial<StripeTaxRateSource> = {},
): StripeTaxRateSource => ({
  active: true,
  country: 'DE',
  display_name: 'VAT',
  id,
  inclusive: true,
  percentage: 19,
  state: null,
  ...overrides,
});

const unusedList: StripeTaxRateApi['list'] = () =>
  Promise.resolve({ data: [], has_more: false });

const unusedRetrieve: StripeTaxRateApi['retrieve'] = (id) =>
  Promise.resolve(stripeRate(id));

describe('Stripe tax-rate service', () => {
  it.effect(
    'paginates past one hundred results under the selected account',
    () =>
      Effect.gen(function* () {
        const firstPage = Array.from({ length: 100 }, (_, index) =>
          stripeRate(`txr_${String(index).padStart(3, '0')}`),
        );
        const requests: {
          readonly account: string;
          readonly active: boolean | undefined;
          readonly cursor: string | undefined;
          readonly inclusive: boolean | undefined;
        }[] = [];
        const stripeTaxRates: StripeTaxRateApi = {
          list: (parameters, options) => {
            requests.push({
              account: options.stripeAccount,
              active: parameters.active,
              cursor: parameters.starting_after,
              inclusive: parameters.inclusive,
            });
            return Promise.resolve(
              parameters.starting_after === undefined
                ? { data: firstPage, has_more: true }
                : { data: [stripeRate('txr_100')], has_more: false },
            );
          },
          retrieve: unusedRetrieve,
        };

        const rates = yield* listStripeTaxRates(
          stripeTaxRates,
          'acct_current',
          { active: true },
        );

        expect(rates).toHaveLength(101);
        expect(requests).toEqual([
          {
            account: 'acct_current',
            active: true,
            cursor: undefined,
            inclusive: undefined,
          },
          {
            account: 'acct_current',
            active: true,
            cursor: 'txr_099',
            inclusive: undefined,
          },
        ]);
      }),
  );

  it.effect('fails instead of silently truncating at the page cap', () =>
    Effect.gen(function* () {
      let page = 0;
      const error = yield* collectStripeTaxRatePages(() => {
        page += 1;
        return Effect.succeed({
          data: [stripeRate(`txr_${page}`)],
          has_more: true,
        });
      }, 2).pipe(Effect.flip);

      expect(page).toBe(2);
      expect(error.reason).toBe('stripeTaxRatePageLimitExceeded');
    }),
  );

  it.effect('rejects an inactive rate during import', () =>
    Effect.gen(function* () {
      const stripeTaxRates: StripeTaxRateApi = {
        list: unusedList,
        retrieve: (id) => Promise.resolve(stripeRate(id, { active: false })),
      };

      const error = yield* loadStripeTaxRatesForImport(
        stripeTaxRates,
        'acct_current',
        ['txr_inactive'],
      ).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: 'RpcBadRequestError',
        reason: 'unsupportedStripeTaxRate',
      });
    }),
  );

  it.effect('rejects an exclusive rate during import', () =>
    Effect.gen(function* () {
      const stripeTaxRates: StripeTaxRateApi = {
        list: unusedList,
        retrieve: (id) => Promise.resolve(stripeRate(id, { inclusive: false })),
      };

      const error = yield* loadStripeTaxRatesForImport(
        stripeTaxRates,
        'acct_current',
        ['txr_exclusive'],
      ).pipe(Effect.flip);

      expect(error).toMatchObject({
        _tag: 'RpcBadRequestError',
        reason: 'unsupportedStripeTaxRate',
      });
    }),
  );

  it.effect('maps an invalid or foreign-account rate ID to a typed error', () =>
    Effect.gen(function* () {
      const requestedAccounts: string[] = [];
      const stripeTaxRates: StripeTaxRateApi = {
        list: unusedList,
        retrieve: (_id, _parameters, options) => {
          requestedAccounts.push(options.stripeAccount);
          return Promise.reject(
            new Stripe.errors.StripeInvalidRequestError({
              headers: {},
              message: 'No such tax rate for account',
              requestId: 'req_tax_rate',
              statusCode: 404,
              type: 'invalid_request_error',
            }),
          );
        },
      };

      const error = yield* loadStripeTaxRatesForImport(
        stripeTaxRates,
        'acct_current',
        ['txr_foreign'],
      ).pipe(Effect.flip);

      expect(requestedAccounts).toEqual(['acct_current']);
      expect(error).toMatchObject({
        _tag: 'RpcBadRequestError',
        reason: 'stripeTaxRateNotFound',
      });
    }),
  );

  it.effect(
    'rejects more than one hundred requested IDs before Stripe calls',
    () =>
      Effect.gen(function* () {
        let retrieveCalls = 0;
        const stripeTaxRates: StripeTaxRateApi = {
          list: unusedList,
          retrieve: (id) => {
            retrieveCalls += 1;
            return Promise.resolve(stripeRate(id));
          },
        };

        const error = yield* loadStripeTaxRatesForImport(
          stripeTaxRates,
          'acct_current',
          Array.from({ length: 101 }, (_, index) => `txr_${index}`),
        ).pipe(Effect.flip);

        expect(retrieveCalls).toBe(0);
        expect(error.reason).toBe('stripeTaxRateImportSizeInvalid');
      }),
  );

  it.effect(
    'loads imports with concurrency ten and account-scoped requests',
    () =>
      Effect.gen(function* () {
        let inFlight = 0;
        let maximumInFlight = 0;
        const requestedAccounts: string[] = [];
        const stripeTaxRates: StripeTaxRateApi = {
          list: unusedList,
          retrieve: async (id, _parameters, options) => {
            requestedAccounts.push(options.stripeAccount);
            inFlight += 1;
            maximumInFlight = Math.max(maximumInFlight, inFlight);
            await new Promise<void>((resolve) => {
              setTimeout(resolve, 1);
            });
            inFlight -= 1;
            return stripeRate(id);
          },
        };

        const result = yield* loadStripeTaxRatesForImport(
          stripeTaxRates,
          'acct_current',
          Array.from({ length: 25 }, (_, index) => `txr_${index}`),
        );

        expect(result.rates).toHaveLength(25);
        expect(maximumInFlight).toBe(10);
        expect(new Set(requestedAccounts)).toEqual(new Set(['acct_current']));
      }),
  );
});
