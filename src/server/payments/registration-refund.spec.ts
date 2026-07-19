import type Stripe from 'stripe';

import { describe, expect, it } from '@effect/vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Effect, Layer, Ref } from 'effect';

import { Database } from '../../db';
import { StripeClient } from '../stripe-client';
import {
  launchRegistrationRefundWorker,
  normalizeRegistrationRefundBatchSize,
  persistedRegistrationRefundStatus,
  processRegistrationRefundClaim,
  reconcileProviderRegistrationRefundWebhook,
  reconcileRegistrationRefundWebhook,
  registrationProviderRefundOperationKey,
  registrationProviderRefundPersistence,
  registrationRefundAmbiguousRecoveryPredicate,
  registrationRefundAmbiguousRecoveryUpdate,
  registrationRefundClaimablePredicate,
  registrationRefundClaimAttempts,
  registrationRefundClaimInsert,
  registrationRefundIdempotencyKey,
  registrationRefundMatchesPersistedClaim,
  registrationRefundRequeueEligibility,
  registrationRefundRetryDelayMs,
  registrationRefundSourcePaymentPredicate,
  registrationRefundStatusCanAdvance,
  registrationRefundStatusUpdate,
} from './registration-refund';

const dialect = new PgDialect();
const normalizeSql = (statement: string): string =>
  statement.replaceAll(/\s+/g, ' ').trim();

describe('registration refund claims', () => {
  it.effect('starts the worker in the enabled production/default mode', () =>
    Effect.gen(function* () {
      const workerRan = yield* Ref.make(false);
      const result = yield* launchRegistrationRefundWorker(
        'enabled',
        Ref.set(workerRan, true),
      );
      yield* Effect.yieldNow;

      expect(result).toBe('started');
      expect(yield* Ref.get(workerRan)).toBe(true);
    }),
  );

  it.effect('does not start the worker in validated Playwright mode', () =>
    Effect.gen(function* () {
      const workerRan = yield* Ref.make(false);
      const result = yield* launchRegistrationRefundWorker(
        'disabledForPlaywright',
        Ref.set(workerRan, true),
      );
      yield* Effect.yieldNow;

      expect(result).toBe('disabledForPlaywright');
      expect(yield* Ref.get(workerRan)).toBe(false);
    }),
  );

  it('persists a null executive for platform-owned claims', () => {
    expect(
      registrationRefundClaimInsert(
        'refund-1',
        {
          amount: 1000,
          applicationFeeRefunded: false,
          currency: 'EUR',
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          sourceTransactionId: 'source-1',
          stripeAccountId: 'acct_1',
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
        },
        'platform-refund:refund-1',
        new Date('2026-07-10T12:00:00.000Z'),
      ),
    ).toEqual(expect.objectContaining({ executiveUserId: null }));
  });

  it('uses the durable claim generation as the stable Stripe idempotency key', () => {
    expect(registrationRefundIdempotencyKey('refund-claim-1')).toBe(
      'registration-refund:refund-claim-1',
    );
    expect(registrationRefundIdempotencyKey('refund-claim-1', 1)).toBe(
      'registration-refund:refund-claim-1:generation:1',
    );
  });

  it('builds a deterministic, non-automatically-retried provider refund record', () => {
    const source = {
      amount: 1200,
      currency: 'EUR' as const,
      eventId: 'event-1',
      eventRegistrationId: 'registration-1',
      id: 'source-1',
      stripeAccountId: 'acct_1',
      targetUserId: 'attendee-1',
      tenantId: 'tenant-1',
    };
    const operationKey = registrationProviderRefundOperationKey('re_external');

    expect(operationKey).toHaveLength(87);
    expect(registrationProviderRefundOperationKey('re_external')).toBe(
      operationKey,
    );
    expect(
      registrationProviderRefundPersistence(
        { amount: 400, id: 're_external', status: 'succeeded' },
        source,
        'refund-1',
      ),
    ).toEqual(
      expect.objectContaining({
        amount: -400,
        comment: 'Refund recorded by Stripe',
        eventRegistrationId: 'registration-1',
        manuallyCreated: false,
        refundOperationKey: operationKey,
        sourceTransactionId: 'source-1',
        status: 'successful',
        stripeAccountId: 'acct_1',
        stripeRefundId: 're_external',
        stripeRefundNextAttemptAt: null,
        stripeRefundStatus: 'succeeded',
        tenantId: 'tenant-1',
      }),
    );
    expect(
      registrationProviderRefundPersistence(
        { amount: 400, id: 're_external', status: 'failed' },
        source,
        'refund-1',
      ),
    ).toMatchObject({ status: 'cancelled', stripeRefundStatus: 'failed' });
  });

  it.effect(
    'resumes a valid metadata-less provider refund without exhausting it',
    () =>
      Effect.gen(function* () {
        const refundId = 're_provider_pending';
        const refundClaimId = 'provider-refund-claim-1';
        const claimedRow = {
          amount: -400,
          currency: 'EUR' as const,
          eventRegistrationId: 'registration-1',
          id: refundClaimId,
          refundOperationKey: registrationProviderRefundOperationKey(refundId),
          sourceTransactionId: 'source-1',
          stripeAccountId: 'acct_1',
          stripeRefundApplicationFee: false,
          stripeRefundAttempts: 1,
          stripeRefundGeneration: 0,
          stripeRefundId: refundId,
          stripeRefundMaxAttempts: 8,
          tenantId: 'tenant-1',
        };
        const source = {
          eventRegistrationId: 'registration-1',
          id: 'source-1',
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
        };
        let finalUpdate: Record<string, unknown> | undefined;
        let releaseUpdate: Record<string, unknown> | undefined;
        let retrieveCount = 0;
        const update = () => ({
          set: (values: Record<string, unknown>) => ({
            where: () => {
              if (typeof values['stripeRefundClaimLeaseId'] === 'string') {
                return {
                  returning: () => Effect.succeed([claimedRow]),
                };
              }
              if ('stripeRefundId' in values) {
                finalUpdate = values;
                return {
                  returning: () => Effect.succeed([{ id: refundClaimId }]),
                };
              }
              releaseUpdate = values;
              return Effect.succeed([]);
            },
          }),
        });
        const emptyJoinedQuery = (): Record<string, unknown> => ({
          innerJoin: () => emptyJoinedQuery(),
          where: () => ({ for: () => Effect.succeed([]) }),
        });
        const tx = {
          select: (selection: Record<string, unknown>) => ({
            from: () =>
              'stripeChargeId' in selection
                ? { where: () => Effect.succeed([source]) }
                : emptyJoinedQuery(),
          }),
          update,
        };
        const database = {
          transaction: (run: (transaction: typeof tx) => unknown) => run(tx),
          update,
        };
        const stripe = {
          refunds: {
            retrieve: () => {
              retrieveCount += 1;
              return Promise.resolve({
                amount: 400,
                charge: 'ch_source',
                currency: 'eur',
                id: refundId,
                metadata: {},
                object: 'refund',
                payment_intent: 'pi_source',
                status: 'succeeded',
              } as Stripe.Refund);
            },
          },
        };

        const result = yield* processRegistrationRefundClaim(
          refundClaimId,
        ).pipe(
          Effect.provideService(StripeClient, stripe as never),
          Effect.provide(Layer.succeed(Database, database as never)),
        );

        expect(result).toEqual({ refundId, status: 'processed' });
        expect(retrieveCount).toBe(1);
        expect(releaseUpdate).toBeUndefined();
        expect(finalUpdate).toMatchObject({
          status: 'successful',
          stripeRefundId: refundId,
          stripeRefundLastError: null,
          stripeRefundNextAttemptAt: null,
          stripeRefundStatus: 'succeeded',
        });
      }),
  );

  it.effect(
    'reconciles one metadata-less provider refund monotonically and rejects ownership mismatches',
    () =>
      Effect.gen(function* () {
        const source = {
          amount: 1200,
          currency: 'EUR' as const,
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'source-1',
          status: 'successful' as const,
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
        };
        let persisted: Record<string, unknown> | undefined;
        let insertCount = 0;
        let updateCount = 0;
        const tx = {
          insert: () => ({
            values: (values: Record<string, unknown>) => ({
              onConflictDoNothing: () => ({
                returning: () => {
                  insertCount += 1;
                  persisted = values;
                  return Effect.succeed([{ id: values['id'] }]);
                },
              }),
            }),
          }),
          select: (selection: Record<string, unknown>) => ({
            from: () => ({
              where: () => {
                const rows =
                  'refundOperationKey' in selection
                    ? persisted
                      ? [persisted]
                      : []
                    : [source];
                return {
                  for: () => Effect.succeed(rows),
                  orderBy: () => ({ for: () => Effect.succeed(rows) }),
                };
              },
            }),
          }),
          update: () => ({
            set: (values: Record<string, unknown>) => ({
              where: () => ({
                returning: () => {
                  updateCount += 1;
                  persisted = { ...persisted, ...values };
                  return Effect.succeed([{ id: persisted['id'] }]);
                },
              }),
            }),
          }),
        };
        const database = {
          transaction: (run: (transaction: typeof tx) => unknown) => run(tx),
        };
        const layer = Layer.succeed(Database, database as never);
        const refund = {
          amount: 400,
          charge: 'ch_source',
          currency: 'eur',
          id: 're_external',
          metadata: {},
          object: 'refund',
          payment_intent: 'pi_source',
          status: 'pending',
        } as Stripe.Refund;

        expect(
          yield* reconcileProviderRegistrationRefundWebhook(
            refund,
            'acct_1',
          ).pipe(Effect.provide(layer)),
        ).toEqual({ status: 'reconciled' });
        expect(insertCount).toBe(1);
        expect(persisted).toMatchObject({
          sourceTransactionId: 'source-1',
          stripeRefundStatus: 'pending',
        });

        expect(
          yield* reconcileProviderRegistrationRefundWebhook(
            { ...refund, status: 'succeeded' } as Stripe.Refund,
            'acct_1',
          ).pipe(Effect.provide(layer)),
        ).toEqual({ status: 'reconciled' });
        expect(updateCount).toBe(1);
        expect(persisted).toMatchObject({
          status: 'successful',
          stripeRefundStatus: 'succeeded',
        });

        expect(
          yield* reconcileProviderRegistrationRefundWebhook(
            refund,
            'acct_1',
          ).pipe(Effect.provide(layer)),
        ).toEqual({ status: 'reconciled' });
        expect(updateCount).toBe(1);

        for (const [candidate, account] of [
          [{ ...refund, amount: 1201 }, 'acct_1'],
          [{ ...refund, currency: 'usd' }, 'acct_1'],
          [refund, 'acct_foreign'],
        ] as const) {
          expect(
            yield* reconcileProviderRegistrationRefundWebhook(
              candidate as Stripe.Refund,
              account,
            ).pipe(Effect.provide(layer)),
          ).toEqual({ status: 'rejected' });
        }
        expect(insertCount).toBe(1);
        expect(updateCount).toBe(1);
      }),
  );

  it.effect(
    'defers a provider refund until its exact pending source payment is finalized',
    () =>
      Effect.gen(function* () {
        let insertCount = 0;
        const source = {
          amount: 1200,
          currency: 'EUR' as const,
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'source-1',
          status: 'pending' as const,
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
        };
        const tx = {
          insert: () => ({
            values: () => ({
              onConflictDoNothing: () => ({
                returning: () => {
                  insertCount += 1;
                  return Effect.succeed([{ id: 'unexpected-refund' }]);
                },
              }),
            }),
          }),
          select: (selection: Record<string, unknown>) => ({
            from: () => ({
              where: () => {
                const rows = 'stripeChargeId' in selection ? [source] : [];
                return {
                  for: () => Effect.succeed(rows),
                  orderBy: () => ({ for: () => Effect.succeed(rows) }),
                };
              },
            }),
          }),
        };
        const layer = Layer.succeed(Database, {
          transaction: (run: (transaction: typeof tx) => unknown) => run(tx),
        } as never);

        expect(
          yield* reconcileProviderRegistrationRefundWebhook(
            {
              amount: 400,
              charge: 'ch_source',
              currency: 'eur',
              id: 're_external_pending_source',
              metadata: {},
              object: 'refund',
              payment_intent: 'pi_source',
              status: 'succeeded',
            } as Stripe.Refund,
            'acct_1',
          ).pipe(Effect.provide(layer)),
        ).toEqual({ status: 'deferred' });
        expect(insertCount).toBe(0);
      }),
  );

  it.effect(
    'rebases an attempted internal claim after a successful partial provider refund',
    () =>
      Effect.gen(function* () {
        const source = {
          amount: 1000,
          currency: 'EUR' as const,
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'source-1',
          status: 'successful' as const,
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
        };
        let claim: Record<string, unknown> = {
          amount: -1000,
          currency: 'EUR',
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'refund-claim-1',
          manuallyCreated: false,
          method: 'stripe',
          refundOperationKey:
            'registration-transfer-source:transfer-1:source-1',
          sourceTransactionId: 'source-1',
          status: 'pending',
          stripeAccountId: 'acct_1',
          stripeRefundAttempts: 1,
          stripeRefundClaimLeaseExpiresAt: null,
          stripeRefundClaimLeaseId: null,
          stripeRefundGeneration: 0,
          stripeRefundHistory: [],
          stripeRefundId: null,
          stripeRefundLastError: null,
          stripeRefundMaxAttempts: 8,
          stripeRefundNextAttemptAt: new Date('2026-07-14T12:00:00.000Z'),
          stripeRefundStatus: null,
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
          type: 'refund',
        };
        let providerRefund: Record<string, unknown> | undefined;
        const tx = {
          insert: () => ({
            values: (values: Record<string, unknown>) => ({
              onConflictDoNothing: () => ({
                returning: () => {
                  providerRefund = values;
                  return Effect.succeed([{ id: values['id'] }]);
                },
              }),
            }),
          }),
          select: (selection: Record<string, unknown>) => ({
            from: () => ({
              where: () => {
                const rows =
                  'stripeChargeId' in selection
                    ? [source]
                    : 'stripeRefundAttempts' in selection
                      ? [claim, ...(providerRefund ? [providerRefund] : [])]
                      : [];
                return {
                  for: () => Effect.succeed(rows),
                  orderBy: () => ({ for: () => Effect.succeed(rows) }),
                };
              },
            }),
          }),
          update: () => ({
            set: (values: Record<string, unknown>) => ({
              where: () => ({
                returning: () => {
                  if (
                    'amount' in values ||
                    (typeof values['stripeRefundLastError'] === 'string' &&
                      values['stripeRefundLastError'].startsWith(
                        'Waiting for Stripe provider refund ',
                      ))
                  ) {
                    claim = { ...claim, ...values };
                    return Effect.succeed([{ id: claim['id'] }]);
                  }
                  providerRefund = { ...providerRefund, ...values };
                  return Effect.succeed([{ id: providerRefund['id'] }]);
                },
              }),
            }),
          }),
        };
        const layer = Layer.succeed(Database, {
          transaction: (run: (transaction: typeof tx) => unknown) => run(tx),
        } as never);

        expect(
          yield* reconcileProviderRegistrationRefundWebhook(
            {
              amount: 400,
              charge: 'ch_source',
              currency: 'eur',
              id: 're_external_partial',
              metadata: {},
              object: 'refund',
              payment_intent: 'pi_source',
              status: 'pending',
            } as Stripe.Refund,
            'acct_1',
          ).pipe(Effect.provide(layer)),
        ).toEqual({ status: 'deferred' });
        expect(providerRefund).toBeUndefined();
        expect(claim).toMatchObject({
          stripeRefundLastError:
            'Waiting for Stripe provider refund re_external_partial to reach a terminal state',
          stripeRefundNextAttemptAt: null,
        });

        expect(
          yield* reconcileProviderRegistrationRefundWebhook(
            {
              amount: 400,
              charge: 'ch_source',
              currency: 'eur',
              id: 're_external_partial',
              metadata: {},
              object: 'refund',
              payment_intent: 'pi_source',
              status: 'succeeded',
            } as Stripe.Refund,
            'acct_1',
          ).pipe(Effect.provide(layer)),
        ).toEqual({ status: 'reconciled' });
        expect(providerRefund).toMatchObject({
          amount: -400,
          stripeRefundId: 're_external_partial',
          stripeRefundStatus: 'succeeded',
        });
        expect(claim).toMatchObject({
          amount: -600,
          status: 'pending',
          stripeRefundAttempts: 0,
          stripeRefundClaimLeaseId: null,
          stripeRefundGeneration: 1,
          stripeRefundId: null,
          stripeRefundStatus: null,
        });

        expect(
          yield* reconcileProviderRegistrationRefundWebhook(
            {
              amount: 400,
              charge: 'ch_source',
              currency: 'eur',
              id: 're_external_partial',
              metadata: {},
              object: 'refund',
              payment_intent: 'pi_source',
              status: 'succeeded',
            } as Stripe.Refund,
            'acct_1',
          ).pipe(Effect.provide(layer)),
        ).toEqual({ status: 'reconciled' });
        expect(claim).toMatchObject({ amount: -600, status: 'pending' });
      }),
  );

  it.effect(
    'adopts an exact successful provider refund into the internal claim',
    () =>
      Effect.gen(function* () {
        const source = {
          amount: 1000,
          currency: 'EUR' as const,
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'source-1',
          status: 'successful' as const,
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
        };
        let claim: Record<string, unknown> = {
          amount: -1000,
          currency: 'EUR',
          eventId: 'event-1',
          eventRegistrationId: 'registration-1',
          id: 'refund-claim-1',
          manuallyCreated: false,
          method: 'stripe',
          refundOperationKey:
            'registration-transfer-source:transfer-1:source-1',
          sourceTransactionId: 'source-1',
          status: 'pending',
          stripeAccountId: 'acct_1',
          stripeRefundAttempts: 0,
          stripeRefundClaimLeaseExpiresAt: null,
          stripeRefundClaimLeaseId: null,
          stripeRefundGeneration: 0,
          stripeRefundHistory: [],
          stripeRefundId: null,
          stripeRefundLastError: null,
          stripeRefundMaxAttempts: 8,
          stripeRefundNextAttemptAt: new Date('2026-07-14T12:00:00.000Z'),
          stripeRefundStatus: null,
          targetUserId: 'attendee-1',
          tenantId: 'tenant-1',
          type: 'refund',
        };
        let insertCount = 0;
        const emptyJoinedQuery = (): Record<string, unknown> => ({
          innerJoin: () => emptyJoinedQuery(),
          where: () => ({ for: () => Effect.succeed([]) }),
        });
        const tx = {
          insert: () => ({
            values: () => ({
              onConflictDoNothing: () => ({
                returning: () => {
                  insertCount += 1;
                  return Effect.succeed([{ id: 'unexpected-provider-row' }]);
                },
              }),
            }),
          }),
          select: (selection: Record<string, unknown>) => ({
            from: () => {
              if (
                'stripeChargeId' in selection ||
                'stripeRefundAttempts' in selection
              ) {
                const rows = 'stripeChargeId' in selection ? [source] : [claim];
                return {
                  where: () => ({
                    for: () => Effect.succeed(rows),
                    orderBy: () => ({ for: () => Effect.succeed(rows) }),
                  }),
                };
              }
              return emptyJoinedQuery();
            },
          }),
          update: () => ({
            set: (values: Record<string, unknown>) => ({
              where: () => ({
                returning: () => {
                  claim = { ...claim, ...values };
                  return Effect.succeed([{ id: claim['id'] }]);
                },
              }),
            }),
          }),
        };
        const layer = Layer.succeed(Database, {
          transaction: (run: (transaction: typeof tx) => unknown) => run(tx),
        } as never);

        expect(
          yield* reconcileProviderRegistrationRefundWebhook(
            {
              amount: 1000,
              charge: 'ch_source',
              currency: 'eur',
              id: 're_external_full',
              metadata: {},
              object: 'refund',
              payment_intent: 'pi_source',
              status: 'succeeded',
            } as Stripe.Refund,
            'acct_1',
          ).pipe(Effect.provide(layer)),
        ).toEqual({ status: 'reconciled' });
        expect(insertCount).toBe(0);
        expect(claim).toMatchObject({
          status: 'successful',
          stripeRefundId: 're_external_full',
          stripeRefundNextAttemptAt: null,
          stripeRefundStatus: 'succeeded',
        });
      }),
  );

  it.effect(
    'reconciles an internal refund by its persisted Stripe ID after metadata is cleared',
    () =>
      Effect.gen(function* () {
        const claim = {
          amount: -1000,
          currency: 'EUR' as const,
          eventRegistrationId: 'registration-1',
          id: 'refund-claim-1',
          refundOperationKey:
            'registration-transfer-source:transfer-1:source-1',
          sourceTransactionId: 'source-1',
          stripeAccountId: 'acct_1',
          stripeRefundAttempts: 1,
          stripeRefundGeneration: 0,
          stripeRefundHistory: [],
          stripeRefundId: 're_internal',
          stripeRefundMaxAttempts: 8,
          stripeRefundStatus: 'pending' as const,
          tenantId: 'tenant-1',
        };
        const source = {
          eventRegistrationId: 'registration-1',
          stripeAccountId: 'acct_1',
          stripeChargeId: 'ch_source',
          stripePaymentIntentId: 'pi_source',
        };
        let update: Record<string, unknown> | undefined;
        const emptyJoinedQuery = (): Record<string, unknown> => ({
          innerJoin: () => emptyJoinedQuery(),
          where: () => ({ for: () => Effect.succeed([]) }),
        });
        const tx = {
          select: (selection: Record<string, unknown>) => ({
            from: () => {
              if ('stripeRefundAttempts' in selection) {
                return {
                  where: () => ({ for: () => Effect.succeed([claim]) }),
                };
              }
              if ('stripeChargeId' in selection) {
                return { where: () => Effect.succeed([source]) };
              }
              return emptyJoinedQuery();
            },
          }),
          update: () => ({
            set: (values: Record<string, unknown>) => ({
              where: () => {
                update = values;
                return Effect.succeed([]);
              },
            }),
          }),
        };
        const layer = Layer.succeed(Database, {
          transaction: (run: (transaction: typeof tx) => unknown) => run(tx),
        } as never);

        expect(
          yield* reconcileRegistrationRefundWebhook(
            {
              amount: 1000,
              charge: 'ch_source',
              currency: 'eur',
              id: 're_internal',
              metadata: {},
              object: 'refund',
              payment_intent: 'pi_source',
              status: 'succeeded',
            } as Stripe.Refund,
            'acct_1',
          ).pipe(Effect.provide(layer)),
        ).toEqual({ status: 'reconciled' });
        expect(update).toMatchObject({
          status: 'successful',
          stripeRefundId: 're_internal',
          stripeRefundStatus: 'succeeded',
        });
      }),
  );

  it.effect(
    'prefers a persisted provider refund ID over unrelated claim-like metadata',
    () =>
      Effect.gen(function* () {
        const claimCandidate = {
          amount: -1000,
          currency: 'EUR' as const,
          eventRegistrationId: 'registration-1',
          id: 'refund-claim-1',
          refundOperationKey:
            'registration-transfer-source:transfer-1:source-1',
          sourceTransactionId: 'source-1',
          stripeAccountId: 'acct_1',
          stripeRefundAttempts: 0,
          stripeRefundGeneration: 0,
          stripeRefundHistory: [],
          stripeRefundId: null,
          stripeRefundMaxAttempts: 8,
          stripeRefundStatus: null,
          tenantId: 'tenant-1',
        };
        const providerCandidate = {
          ...claimCandidate,
          amount: -400,
          id: 'provider-ledger-1',
          refundOperationKey:
            registrationProviderRefundOperationKey('re_provider'),
          stripeRefundId: 're_provider',
          stripeRefundStatus: 'succeeded' as const,
        };
        const tx = {
          select: () => ({
            from: () => ({
              where: () => ({
                for: () => Effect.succeed([claimCandidate, providerCandidate]),
              }),
            }),
          }),
        };
        const layer = Layer.succeed(Database, {
          transaction: (run: (transaction: typeof tx) => unknown) => run(tx),
        } as never);

        expect(
          yield* reconcileRegistrationRefundWebhook(
            {
              amount: 400,
              charge: 'ch_source',
              currency: 'eur',
              id: 're_provider',
              metadata: { refundClaimId: 'refund-claim-1' },
              object: 'refund',
              payment_intent: 'pi_source',
              status: 'succeeded',
            } as Stripe.Refund,
            'acct_1',
          ).pipe(Effect.provide(layer)),
        ).toEqual({ status: 'notClaim' });
      }),
  );

  it('only creates a new refund generation for a known terminal Stripe refund', () => {
    const base = {
      attempts: 8,
      leaseExpiresAt: null,
      leaseId: null,
      maxAttempts: 8,
      nextAttemptAt: null,
      refundId: 're_failed',
      status: 'pending' as const,
      stripeRefundStatus: 'failed' as const,
    };
    expect(registrationRefundRequeueEligibility(base)).toBe('newGeneration');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        refundId: null,
      }),
    ).toBe('ambiguous');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        refundId: null,
        stripeRefundStatus: null,
      }),
    ).toBe('ambiguous');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        status: 'successful',
        stripeRefundStatus: 'succeeded',
      }),
    ).toBe('succeeded');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        leaseId: 'lease-active',
      }),
    ).toBe('ambiguous');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        leaseExpiresAt: new Date('2026-07-10T12:10:00.000Z'),
        leaseId: 'lease-active',
        refundId: null,
        stripeRefundStatus: null,
      }),
    ).toBe('active');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        attempts: 1,
        nextAttemptAt: new Date('2026-07-10T12:10:00.000Z'),
        refundId: null,
        stripeRefundStatus: null,
      }),
    ).toBe('active');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        nextAttemptAt: new Date('2026-07-10T12:10:00.000Z'),
        refundId: null,
        stripeRefundStatus: 'pending',
      }),
    ).toBe('ambiguous');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        attempts: 1,
        refundId: null,
        stripeRefundStatus: null,
      }),
    ).toBe('ambiguous');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        attempts: 0,
        refundId: null,
        stripeRefundStatus: null,
      }),
    ).toBe('resumeGeneration');
    expect(
      registrationRefundRequeueEligibility({
        ...base,
        refundId: 're_processing',
        stripeRefundStatus: 'pending',
      }),
    ).toBe('resumeGeneration');
  });

  it('bounds worker batch sizes and exponential retry delays', () => {
    expect(normalizeRegistrationRefundBatchSize()).toBe(25);
    expect(normalizeRegistrationRefundBatchSize(0)).toBe(1);
    expect(normalizeRegistrationRefundBatchSize(12.9)).toBe(12);
    expect(normalizeRegistrationRefundBatchSize(1000)).toBe(100);
    expect(normalizeRegistrationRefundBatchSize(NaN)).toBe(25);

    expect(registrationRefundRetryDelayMs(1)).toBe(1000);
    expect(registrationRefundRetryDelayMs(4)).toBe(8000);
    expect(registrationRefundRetryDelayMs(100)).toBe(30 * 60 * 1000);
  });

  it('maps only Stripe refund states that can be persisted', () => {
    expect(persistedRegistrationRefundStatus('requires_action')).toBe(
      'requires_action',
    );
    expect(persistedRegistrationRefundStatus('succeeded')).toBe('succeeded');
    expect(persistedRegistrationRefundStatus('future_status')).toBe('pending');
    expect(persistedRegistrationRefundStatus(null)).toBe('pending');
  });

  it('stops polling non-terminal provider states when retry budget is exhausted', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    expect(
      registrationRefundStatusUpdate(
        { id: 're_pending', status: 'pending' },
        now,
        8,
        8,
      ),
    ).toMatchObject({
      stripeRefundLastError:
        'Stripe refund remained pending after maximum processing attempts',
      stripeRefundNextAttemptAt: null,
      stripeRefundStatus: 'pending',
    });
    expect(
      registrationRefundStatusUpdate(
        { id: 're_pending', status: 'pending' },
        now,
        7,
        8,
      ).stripeRefundNextAttemptAt,
    ).toEqual(new Date('2026-07-10T12:01:00.000Z'));
  });

  it('does not let stale pending events downgrade terminal refund outcomes', () => {
    expect(registrationRefundStatusCanAdvance(null, 'pending')).toBe(true);
    expect(registrationRefundStatusCanAdvance('pending', 'succeeded')).toBe(
      true,
    );
    expect(
      registrationRefundStatusCanAdvance('requires_action', 'canceled'),
    ).toBe(true);
    expect(registrationRefundStatusCanAdvance('succeeded', 'pending')).toBe(
      false,
    );
    expect(registrationRefundStatusCanAdvance('failed', 'pending')).toBe(false);
    expect(registrationRefundStatusCanAdvance('canceled', 'canceled')).toBe(
      true,
    );
  });

  it('accepts refund reconciliation only for exact claim metadata and source ownership', () => {
    const refund = {
      amount: 1000,
      charge: null,
      currency: 'eur',
      metadata: {
        refundClaimId: 'refund-1',
        refundGeneration: '0',
        registrationId: 'registration-1',
        sourceTransactionId: 'source-1',
        tenantId: 'tenant-1',
      },
      payment_intent: 'pi_1',
    } as Stripe.Refund;
    const expected = {
      amount: 1000,
      currency: 'EUR',
      refundClaimId: 'refund-1',
      refundGeneration: 0,
      registrationId: 'registration-1',
      sourceTransactionId: 'source-1',
      stripeReference: { paymentIntent: 'pi_1' },
      tenantId: 'tenant-1',
    } as const;

    expect(registrationRefundMatchesPersistedClaim(refund, expected)).toBe(
      true,
    );
    expect(
      registrationRefundMatchesPersistedClaim(
        { ...refund, amount: 999 } as Stripe.Refund,
        expected,
      ),
    ).toBe(false);
    expect(
      registrationRefundMatchesPersistedClaim(
        { ...refund, payment_intent: 'pi_other' } as Stripe.Refund,
        expected,
      ),
    ).toBe(false);
    expect(
      registrationRefundMatchesPersistedClaim(refund, {
        ...expected,
        refundGeneration: 1,
      }),
    ).toBe(false);
  });

  it('accepts exact registration or add-on Stripe sources without weakening ownership', () => {
    const query = dialect.sqlToQuery(
      registrationRefundSourcePaymentPredicate({
        eventRegistrationId: 'registration-1',
        sourceTransactionId: 'source-1',
        stripeAccountId: 'acct_1',
        tenantId: 'tenant-1',
      }),
    );
    const statement = normalizeSql(query.sql);

    expect(statement).toContain('"transactions"."eventRegistrationId" =');
    expect(statement).toContain('"transactions"."stripe_account_id" =');
    expect(statement).toContain('"transactions"."type" in');
    expect(query.params).toEqual([
      'source-1',
      'registration-1',
      'stripe',
      'successful',
      'acct_1',
      'tenant-1',
      'registration',
      'addon',
    ]);
  });

  it('only retries recent id-less refund requests while known refunds remain retrievable', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const claimable = dialect.sqlToQuery(
      registrationRefundClaimablePredicate(now),
    );
    const statement = normalizeSql(claimable.sql);

    expect(statement).toContain(
      '"transactions"."stripe_refund_attempts" < "transactions"."stripe_refund_max_attempts"',
    );
    expect(statement).toContain(
      '"transactions"."stripe_refund_claim_lease_id" is not null',
    );
    expect(statement).toContain(
      '"transactions"."stripe_refund_claim_lease_expires_at" <=',
    );
    expect(statement).toContain(
      '"transactions"."stripe_refund_id" is not null',
    );
    expect(statement).toContain('"transactions"."stripe_refund_id" is null');
    expect(statement).toContain(
      '"transactions"."stripe_refund_claim_lease_expires_at" >',
    );
    expect(statement).toContain(
      '"transactions"."stripe_refund_next_attempt_at" >',
    );
    expect(statement).toContain(
      'coalesce("transactions"."stripe_refund_requeued_at", "transactions"."createdAt") >',
    );
    expect(statement).toContain('"transactions"."stripe_refund_attempts" =');
    expect(statement).toContain('"transactions"."stripe_refund_attempts" >');
    expect(claimable.params).toContain('2026-07-09T14:00:00.000Z');

    const ambiguous = dialect.sqlToQuery(
      registrationRefundAmbiguousRecoveryPredicate(now),
    );
    const ambiguousStatement = normalizeSql(ambiguous.sql);
    expect(ambiguousStatement).toContain(
      '"transactions"."stripe_refund_id" is null',
    );
    expect(ambiguousStatement).toContain(
      '"transactions"."stripe_refund_claim_lease_expires_at" <=',
    );
    expect(ambiguousStatement).toContain(
      '"transactions"."stripe_refund_next_attempt_at" <=',
    );
    expect(ambiguousStatement).toContain(
      'coalesce("transactions"."stripe_refund_requeued_at", "transactions"."createdAt") <=',
    );
    expect(ambiguousStatement).toContain(
      '"transactions"."stripe_refund_attempts" =',
    );
    expect(ambiguousStatement).toContain(
      '"transactions"."stripe_refund_attempts" >',
    );
    expect(ambiguous.params).toContain('2026-07-09T14:00:00.000Z');
    expect(registrationRefundAmbiguousRecoveryUpdate()).toEqual({
      stripeRefundClaimLeaseExpiresAt: null,
      stripeRefundClaimLeaseId: null,
      stripeRefundLastError:
        'Automatic recovery stopped because the prior Stripe refund attempt is too old to retry safely without a persisted refund ID; reconcile the claim with Stripe manually',
      stripeRefundNextAttemptAt: null,
    });

    const attempts = dialect.sqlToQuery(registrationRefundClaimAttempts());
    expect(normalizeSql(attempts.sql)).toBe(
      'case when "transactions"."stripe_refund_claim_lease_id" is null then "transactions"."stripe_refund_attempts" + 1 else "transactions"."stripe_refund_attempts" end',
    );
  });
});
