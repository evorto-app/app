import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';

import type {
  StripeTaxRateAccountRotationApplyOperations,
  StripeTaxRateAccountRotationLockedState,
  StripeTaxRateAccountRotationStripeClient,
  StripeTaxRateAccountRotationTargetRate,
} from './stripe-tax-rate-account-rotation';

import {
  buildStripeTaxRateAccountRotationPlan,
  executeStripeTaxRateAccountRotationPlan,
  fetchStripeTaxRateAccountRotationTargetRates,
} from './stripe-tax-rate-account-rotation';

const providerRate = ({
  country = 'DE',
  displayName = 'VAT',
  id = 'txr_target_vat',
  percentage = 19,
  state = null,
}: {
  readonly country?: null | string;
  readonly displayName?: string;
  readonly id?: string;
  readonly percentage?: number;
  readonly state?: null | string;
} = {}) => ({
  active: true,
  country,
  display_name: displayName,
  id,
  inclusive: true,
  percentage,
  state,
});

const targetRate = ({
  country = 'DE',
  displayName = 'VAT',
  id = 'txr_target_vat',
  percentage = '19',
  state = null,
}: {
  readonly country?: null | string;
  readonly displayName?: string;
  readonly id?: string;
  readonly percentage?: string;
  readonly state?: null | string;
} = {}): StripeTaxRateAccountRotationTargetRate => ({
  country,
  displayName,
  percentage,
  state,
  stripeTaxRateId: id,
});

const lockedState = (): StripeTaxRateAccountRotationLockedState => ({
  bindings: [
    {
      id: 'event-option-approved-historical',
      kind: 'eventRegistrationOption',
      parentId: 'event-approved-historical',
      sourceStripeTaxRateId: 'txr_source_vat',
    },
    {
      id: 'event-addon-1',
      kind: 'eventAddon',
      parentId: 'event-current',
      sourceStripeTaxRateId: 'txr_source_reduced',
    },
    {
      id: 'template-option-1',
      kind: 'templateRegistrationOption',
      parentId: 'template-1',
      sourceStripeTaxRateId: 'txr_source_reduced',
    },
    {
      id: 'template-addon-1',
      kind: 'templateAddon',
      parentId: 'template-1',
      sourceStripeTaxRateId: 'txr_source_vat',
    },
  ],
  sourceMetadata: [
    {
      country: ' de ',
      displayName: ' VAT ',
      inclusive: true,
      percentage: '19.00',
      state: null,
      stripeAccountId: 'acct_source',
      stripeTaxRateId: 'txr_source_vat',
    },
    {
      country: 'de',
      displayName: 'Reduced   VAT',
      inclusive: true,
      percentage: '7.0',
      state: ' be ',
      stripeAccountId: 'acct_source',
      stripeTaxRateId: 'txr_source_reduced',
    },
  ],
});

const buildPlan = (
  targetRates: readonly StripeTaxRateAccountRotationTargetRate[],
) =>
  buildStripeTaxRateAccountRotationPlan({
    lockedState: lockedState(),
    sourceStripeAccountId: 'acct_source',
    targetRates,
    targetStripeAccountId: 'acct_target',
    tenantId: 'tenant-1',
  });

describe('Stripe tax-rate account rotation', () => {
  it.effect('manually fetches every active inclusive target-account page', () =>
    Effect.gen(function* () {
      const requests: {
        readonly active: true;
        readonly inclusive: true;
        readonly limit: 100;
        readonly startingAfter?: string;
        readonly stripeAccountId: string;
      }[] = [];
      const pages: unknown[] = [
        {
          data: [providerRate()],
          has_more: true,
        },
        {
          data: [
            providerRate({
              displayName: 'Reduced VAT',
              id: 'txr_target_reduced',
              percentage: 7,
              state: 'BE',
            }),
          ],
          has_more: false,
        },
      ];
      const stripe: StripeTaxRateAccountRotationStripeClient = {
        taxRates: {
          list: (parameters, options) => {
            requests.push({
              active: parameters.active,
              inclusive: parameters.inclusive,
              limit: parameters.limit,
              ...(parameters.starting_after !== undefined && {
                startingAfter: parameters.starting_after,
              }),
              stripeAccountId: options.stripeAccount,
            });
            return Promise.resolve(pages.shift());
          },
        },
      };

      const rates = yield* fetchStripeTaxRateAccountRotationTargetRates(
        stripe,
        'acct_target',
      );

      assert.deepStrictEqual(
        rates.map((rate) => rate.stripeTaxRateId),
        ['txr_target_vat', 'txr_target_reduced'],
      );
      assert.deepStrictEqual(requests, [
        {
          active: true,
          inclusive: true,
          limit: 100,
          stripeAccountId: 'acct_target',
        },
        {
          active: true,
          inclusive: true,
          limit: 100,
          startingAfter: 'txr_target_vat',
          stripeAccountId: 'acct_target',
        },
      ]);
    }),
  );

  it.effect('returns an actionable bad request when Stripe loading fails', () =>
    Effect.gen(function* () {
      const stripe: StripeTaxRateAccountRotationStripeClient = {
        taxRates: {
          list: () => Promise.reject(new Error('account unavailable')),
        },
      };

      const error = yield* fetchStripeTaxRateAccountRotationTargetRates(
        stripe,
        'acct_target',
      ).pipe(Effect.flip);

      assert.strictEqual(error._tag, 'RpcBadRequestError');
      assert.include(error.message, 'replacement account');
      assert.include(error.reason ?? '', 'No account or tax-rate changes');
    }),
  );

  it.effect(
    'maps all four exact binding sets, including an approved historical event',
    () =>
      Effect.gen(function* () {
        const plan = yield* buildPlan([
          targetRate({ displayName: ' vat ', id: 'txr_target_vat' }),
          targetRate({
            country: 'DE',
            displayName: 'reduced vat',
            id: 'txr_target_reduced',
            percentage: '7',
            state: 'BE',
          }),
          targetRate({
            country: 'AT',
            displayName: 'Unrelated',
            id: 'txr_unrelated',
            percentage: '20',
          }),
        ]);

        assert.deepStrictEqual(plan.bindings, [
          {
            id: 'event-option-approved-historical',
            kind: 'eventRegistrationOption',
            parentId: 'event-approved-historical',
            sourceStripeTaxRateId: 'txr_source_vat',
            targetStripeTaxRateId: 'txr_target_vat',
          },
          {
            id: 'event-addon-1',
            kind: 'eventAddon',
            parentId: 'event-current',
            sourceStripeTaxRateId: 'txr_source_reduced',
            targetStripeTaxRateId: 'txr_target_reduced',
          },
          {
            id: 'template-option-1',
            kind: 'templateRegistrationOption',
            parentId: 'template-1',
            sourceStripeTaxRateId: 'txr_source_reduced',
            targetStripeTaxRateId: 'txr_target_reduced',
          },
          {
            id: 'template-addon-1',
            kind: 'templateAddon',
            parentId: 'template-1',
            sourceStripeTaxRateId: 'txr_source_vat',
            targetStripeTaxRateId: 'txr_target_vat',
          },
        ]);
        assert.deepStrictEqual(
          plan.targetRates.map((rate) => rate.stripeTaxRateId),
          ['txr_target_vat', 'txr_target_reduced'],
        );
      }),
  );

  it.effect(
    'rejects missing and ambiguous target matches during read-only planning',
    () =>
      Effect.gen(function* () {
        const writes = 0;
        const missing = yield* buildPlan([
          targetRate({ displayName: 'VAT', id: 'txr_target_vat' }),
        ]).pipe(Effect.flip);
        assert.include(missing.message, 'missing a matching');
        assert.strictEqual(writes, 0);

        const ambiguous = yield* buildPlan([
          targetRate({ id: 'txr_target_vat_1' }),
          targetRate({ id: 'txr_target_vat_2' }),
          targetRate({
            displayName: 'Reduced VAT',
            id: 'txr_target_reduced',
            percentage: '7',
            state: 'BE',
          }),
        ]).pipe(Effect.flip);
        assert.include(ambiguous.message, 'multiple matching');
        assert.strictEqual(writes, 0);
      }),
  );

  it.effect(
    'accepts source metadata only from the current tenant account',
    () =>
      Effect.gen(function* () {
        const state = lockedState();
        const error = yield* buildStripeTaxRateAccountRotationPlan({
          lockedState: {
            ...state,
            sourceMetadata: state.sourceMetadata.map((metadata) =>
              metadata.stripeTaxRateId === 'txr_source_vat'
                ? { ...metadata, stripeAccountId: 'acct_other' }
                : metadata,
            ),
          },
          sourceStripeAccountId: 'acct_source',
          targetRates: [
            targetRate(),
            targetRate({
              displayName: 'Reduced VAT',
              id: 'txr_target_reduced',
              percentage: '7',
              state: 'BE',
            }),
          ],
          targetStripeAccountId: 'acct_target',
          tenantId: 'tenant-1',
        }).pipe(Effect.flip);

        assert.include(error.message, 'no unique source-account metadata');
      }),
  );

  it.effect(
    'upserts matched target metadata then remaps every exact locked row set',
    () =>
      Effect.gen(function* () {
        const plan = yield* buildPlan([
          targetRate(),
          targetRate({
            displayName: 'Reduced VAT',
            id: 'txr_target_reduced',
            percentage: '7',
            state: 'BE',
          }),
          targetRate({
            country: 'AT',
            displayName: 'Unrelated',
            id: 'txr_unrelated',
            percentage: '20',
          }),
        ]);
        const operationsLog: string[] = [];
        const operations: StripeTaxRateAccountRotationApplyOperations = {
          currentStripeAccountId: (tenantId) => {
            operationsLog.push(`account:${tenantId}`);
            return Effect.succeed('acct_target');
          },
          remapBinding: (tenantId, binding) => {
            operationsLog.push(
              `${binding.kind}:${tenantId}:${binding.id}:${binding.sourceStripeTaxRateId}->${binding.targetStripeTaxRateId}`,
            );
            return Effect.succeed(true);
          },
          upsertTargetRate: (tenantId, stripeAccountId, rate) => {
            operationsLog.push(
              `upsert:${tenantId}:${stripeAccountId}:${rate.stripeTaxRateId}`,
            );
            return Effect.void;
          },
        };

        yield* executeStripeTaxRateAccountRotationPlan(operations, plan);

        assert.deepStrictEqual(operationsLog, [
          'account:tenant-1',
          'upsert:tenant-1:acct_target:txr_target_vat',
          'upsert:tenant-1:acct_target:txr_target_reduced',
          'eventRegistrationOption:tenant-1:event-option-approved-historical:txr_source_vat->txr_target_vat',
          'eventAddon:tenant-1:event-addon-1:txr_source_reduced->txr_target_reduced',
          'templateRegistrationOption:tenant-1:template-option-1:txr_source_reduced->txr_target_reduced',
          'templateAddon:tenant-1:template-addon-1:txr_source_vat->txr_target_vat',
        ]);
      }),
  );

  it.effect(
    'refuses to write before the tenant has switched to the target',
    () =>
      Effect.gen(function* () {
        const plan = yield* buildPlan([
          targetRate(),
          targetRate({
            displayName: 'Reduced VAT',
            id: 'txr_target_reduced',
            percentage: '7',
            state: 'BE',
          }),
        ]);
        let writes = 0;
        const write = () => {
          writes += 1;
          return Effect.succeed(true);
        };
        const operations: StripeTaxRateAccountRotationApplyOperations = {
          currentStripeAccountId: () => Effect.succeed('acct_source'),
          remapBinding: write,
          upsertTargetRate: () => {
            writes += 1;
            return Effect.void;
          },
        };

        const error = yield* executeStripeTaxRateAccountRotationPlan(
          operations,
          plan,
        ).pipe(Effect.flip);

        assert.include(error.message, 'did not reach');
        assert.strictEqual(writes, 0);
      }),
  );
});
