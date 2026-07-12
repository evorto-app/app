import type Stripe from 'stripe';

import { describe, expect, it } from '@effect/vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Effect, Ref } from 'effect';

import {
  launchRegistrationRefundWorker,
  normalizeRegistrationRefundBatchSize,
  persistedRegistrationRefundStatus,
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

  it('reclaims stale leases without requiring another retry budget slot', () => {
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

    const attempts = dialect.sqlToQuery(registrationRefundClaimAttempts());
    expect(normalizeSql(attempts.sql)).toBe(
      'case when "transactions"."stripe_refund_claim_lease_id" is null then "transactions"."stripe_refund_attempts" + 1 else "transactions"."stripe_refund_attempts" end',
    );
  });
});
