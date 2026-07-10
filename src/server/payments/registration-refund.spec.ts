import type Stripe from 'stripe';

import { describe, expect, it } from '@effect/vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
  normalizeRegistrationRefundBatchSize,
  persistedRegistrationRefundStatus,
  registrationRefundClaimablePredicate,
  registrationRefundClaimAttempts,
  registrationRefundClaimInsert,
  registrationRefundIdempotencyKey,
  registrationRefundMatchesPersistedClaim,
  registrationRefundRequeueEligibility,
  registrationRefundRetryDelayMs,
  registrationRefundStatusCanAdvance,
} from './registration-refund';

const dialect = new PgDialect();
const normalizeSql = (statement: string): string =>
  statement.replaceAll(/\s+/g, ' ').trim();

describe('registration refund claims', () => {
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
    ).toBe('resumeGeneration');
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
