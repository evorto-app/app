import { assert, describe, it } from '@effect/vitest';
import { Effect } from 'effect';
import { readFileSync } from 'node:fs';

import type {
  LegacyStripeTaxRateRow,
  StripeTaxRateAccountBackfillOperations,
  VerifiedStripeTaxRateSnapshot,
} from './stripe-tax-rate-account-backfill';

import {
  createRequireOwnedStripeTaxRateTriggerSql,
  createRequireTaxRateCleanupBeforeAccountChangeTriggerSql,
  executeStripeTaxRateAccountBackfill,
  lockTaxRatesForStripeTaxRateRolloutSql,
  lockTenantsForStripeTaxRateRolloutSql,
  requireOwnedStripeTaxRateFunctionSql,
  requireTaxRateCleanupBeforeAccountChangeFunctionSql,
  StripeTaxRateAccountBackfillError,
  verifyStripeTaxRateBackfillSnapshot,
} from './stripe-tax-rate-account-backfill';

const legacyRow = (
  overrides: Partial<LegacyStripeTaxRateRow> = {},
): LegacyStripeTaxRateRow => ({
  active: false,
  capturedStripeAccountId: 'acct_current',
  country: null,
  displayName: null,
  id: 'tax-rate-row-1',
  inclusive: false,
  percentage: null,
  state: null,
  stripeTaxRateId: 'txr_verified',
  tenantExists: true,
  tenantId: 'tenant-1',
  ...overrides,
});

const providerRate = (overrides: Record<string, unknown> = {}) => ({
  active: true,
  country: 'DE',
  display_name: 'VAT',
  id: 'txr_verified',
  inclusive: true,
  percentage: 19,
  state: 'BE',
  ...overrides,
});

const makeOperations = (
  overrides: Partial<StripeTaxRateAccountBackfillOperations> = {},
): StripeTaxRateAccountBackfillOperations => ({
  commitVerifiedSnapshot: () => Effect.succeed('updated'),
  installRolloutGuards: () => Effect.void,
  listLegacyRows: () => Effect.succeed([legacyRow()]),
  retrieveStripeTaxRate: () => Effect.succeed(providerRate()),
  ...overrides,
});

describe('Stripe tax-rate account backfill', () => {
  it('names the commit and rollout-guard operation phases', () => {
    const source = readFileSync(
      new URL('stripe-tax-rate-account-backfill.ts', import.meta.url),
      'utf8',
    );

    assert.include(
      source,
      "'StripeTaxRateAccountBackfill.commitVerifiedSnapshot'",
    );
    assert.include(
      source,
      "'StripeTaxRateAccountBackfill.installRolloutGuards'",
    );
  });

  it.effect(
    'uses the exact Connect response as provider-authoritative metadata',
    () =>
      Effect.gen(function* () {
        const snapshot = yield* verifyStripeTaxRateBackfillSnapshot(
          legacyRow({
            active: false,
            country: 'AT',
            displayName: 'stale',
            inclusive: false,
            percentage: '7',
            state: '9',
          }),
          providerRate(),
        );

        assert.deepStrictEqual(snapshot, {
          active: true,
          country: 'DE',
          displayName: 'VAT',
          inclusive: true,
          percentage: '19',
          state: 'BE',
          stripeTaxRateId: 'txr_verified',
        });
      }),
  );

  it.effect('rejects a provider response for a different tax-rate id', () =>
    Effect.gen(function* () {
      const error = yield* verifyStripeTaxRateBackfillSnapshot(
        legacyRow(),
        providerRate({ id: 'txr_other' }),
      ).pipe(Effect.flip);

      assert.strictEqual(error.reason, 'providerTaxRateMismatch');
    }),
  );

  it.effect('rejects malformed and out-of-range percentages', () =>
    Effect.gen(function* () {
      for (const percentage of [NaN, Infinity, -1, 101]) {
        const error = yield* verifyStripeTaxRateBackfillSnapshot(
          legacyRow(),
          providerRate({ percentage }),
        ).pipe(Effect.flip);

        assert.strictEqual(error.reason, 'providerResponseInvalid');
      }
    }),
  );

  it.effect(
    'refreshes a partial same-account concurrent stamp and then installs guards',
    () =>
      Effect.gen(function* () {
        const events: string[] = [];
        const snapshots: VerifiedStripeTaxRateSnapshot[] = [];
        const summary = yield* executeStripeTaxRateAccountBackfill(
          makeOperations({
            commitVerifiedSnapshot: (_row, stripeAccountId, snapshot) =>
              Effect.sync(() => {
                events.push(`commit:${stripeAccountId}`);
                snapshots.push(snapshot);
                return 'alreadyBackfilled';
              }),
            installRolloutGuards: () =>
              Effect.sync(() => {
                events.push('guards');
              }),
            retrieveStripeTaxRate: (stripeAccountId, stripeTaxRateId) =>
              Effect.sync(() => {
                events.push(`retrieve:${stripeAccountId}:${stripeTaxRateId}`);
                return providerRate({
                  display_name: 'Provider refreshed VAT',
                  percentage: 7.7,
                });
              }),
          }),
        );

        assert.deepStrictEqual(events, [
          'retrieve:acct_current:txr_verified',
          'commit:acct_current',
          'guards',
        ]);
        assert.deepStrictEqual(snapshots, [
          {
            active: true,
            country: 'DE',
            displayName: 'Provider refreshed VAT',
            inclusive: true,
            percentage: '7.7',
            state: 'BE',
            stripeTaxRateId: 'txr_verified',
          },
        ]);
        assert.deepStrictEqual(summary, {
          alreadyBackfilled: 1,
          removed: 0,
          scanned: 1,
          updated: 0,
        });
      }),
  );

  it.effect(
    'fails before provider access when a legacy row has no connected account',
    () =>
      Effect.gen(function* () {
        let providerCalled = false;
        const error = yield* executeStripeTaxRateAccountBackfill(
          makeOperations({
            listLegacyRows: () =>
              Effect.succeed([legacyRow({ capturedStripeAccountId: null })]),
            retrieveStripeTaxRate: () =>
              Effect.sync(() => {
                providerCalled = true;
                return providerRate();
              }),
          }),
        ).pipe(Effect.flip);

        assert.strictEqual(error.reason, 'missingStripeAccount');
        assert.isFalse(providerCalled);
      }),
  );

  it.effect(
    'keeps partial progress retryable when a later provider lookup fails',
    () =>
      Effect.gen(function* () {
        const committed: string[] = [];
        const rows = [
          legacyRow({ id: 'row-1', stripeTaxRateId: 'txr_verified' }),
          legacyRow({ id: 'row-2', stripeTaxRateId: 'txr_unavailable' }),
        ];
        const error = yield* executeStripeTaxRateAccountBackfill(
          makeOperations({
            commitVerifiedSnapshot: (row) =>
              Effect.sync(() => {
                committed.push(row.id);
                return 'updated';
              }),
            listLegacyRows: () => Effect.succeed(rows),
            retrieveStripeTaxRate: (_accountId, stripeTaxRateId) =>
              stripeTaxRateId === 'txr_unavailable'
                ? Effect.fail(
                    new StripeTaxRateAccountBackfillError({
                      message: 'provider unavailable',
                      reason: 'providerRequestFailed',
                      stripeTaxRateId,
                    }),
                  )
                : Effect.succeed(providerRate()),
          }),
        ).pipe(Effect.flip);

        assert.strictEqual(error.reason, 'providerRequestFailed');
        assert.deepStrictEqual(committed, ['row-1']);
      }),
  );

  it.effect(
    'blocks completion when the atomic rollout guard invariant fails',
    () =>
      Effect.gen(function* () {
        const error = yield* executeStripeTaxRateAccountBackfill(
          makeOperations({
            installRolloutGuards: () =>
              Effect.fail(
                new StripeTaxRateAccountBackfillError({
                  message: 'invalid bindings remain',
                  reason: 'remainingLegacyRows',
                  remainingCount: 2,
                }),
              ),
          }),
        ).pipe(Effect.flip);

        assert.strictEqual(error.reason, 'remainingLegacyRows');
        assert.strictEqual(error.remainingCount, 2);
      }),
  );

  it('schema-qualifies both rollout locks and temporary guard triggers', () => {
    assert.strictEqual(
      lockTenantsForStripeTaxRateRolloutSql,
      'LOCK TABLE public.tenants IN SHARE ROW EXCLUSIVE MODE',
    );
    assert.strictEqual(
      lockTaxRatesForStripeTaxRateRolloutSql,
      'LOCK TABLE public.tenant_stripe_tax_rates IN SHARE ROW EXCLUSIVE MODE',
    );
    assert.include(
      requireOwnedStripeTaxRateFunctionSql,
      'NEW."stripeAccountId" IS NULL',
    );
    assert.include(
      createRequireOwnedStripeTaxRateTriggerSql,
      'ON public.tenant_stripe_tax_rates',
    );
    assert.include(
      requireTaxRateCleanupBeforeAccountChangeFunctionSql,
      'FROM public.tenant_stripe_tax_rates',
    );
    assert.include(
      createRequireTaxRateCleanupBeforeAccountChangeTriggerSql,
      'ON public.tenants',
    );
  });
});
