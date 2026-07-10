import { describe, expect, it, vi } from '@effect/vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Effect } from 'effect';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../db';
import { StripeClient } from '../stripe-client';
import {
  boundExpiredCheckoutReconciliationAction,
  checkoutReconcileBackoffMs,
  dueBoundRegistrationCheckoutPredicate,
  expiredBoundRegistrationClaimPredicate,
  expiredUnboundRegistrationClaimPredicate,
  nextRegistrationCheckoutReconcileAt,
  normalizeExpiredCheckoutCleanupBatchSize,
  reconcileExpiredBoundRegistrationCheckout,
  reconcileExpiredRegistrationTransferCheckout,
} from './expired-checkout-cleanup';
import { expiredRegistrationTransferCheckoutCandidatePredicate } from './registration-transfer-finalization';

describe('expired checkout cleanup', () => {
  it('keeps every sweep within the configured batch bound', () => {
    expect(normalizeExpiredCheckoutCleanupBatchSize()).toBe(25);
    expect(normalizeExpiredCheckoutCleanupBatchSize(0)).toBe(1);
    expect(normalizeExpiredCheckoutCleanupBatchSize(12.9)).toBe(12);
    expect(normalizeExpiredCheckoutCleanupBatchSize(1000)).toBe(100);
    expect(normalizeExpiredCheckoutCleanupBatchSize(NaN)).toBe(25);
  });

  it('matches only expired pending registration claims without a bound session', () => {
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(
      expiredUnboundRegistrationClaimPredicate(1_750_000_000),
    );

    expect(query.sql).toContain('"transactions"."method" = $1');
    expect(query.sql).toContain('"transactions"."status" = $2');
    expect(query.sql).toContain('"transactions"."type" = $3');
    expect(query.sql).toContain(
      '"transactions"."eventRegistrationId" is not null',
    );
    expect(query.sql).toContain(
      '"transactions"."stripe_checkout_request" is not null',
    );
    expect(query.sql).toContain(
      '"transactions"."stripeCheckoutSessionId" is null',
    );
    expect(query.sql).toContain('jsonb_path_exists');
    expect(query.sql).toContain('$.expiresAt');
    expect(query.sql).toContain('from "registration_transfers"');
    expect(query.sql).toContain(
      '"registration_transfers"."recipient_checkout_transaction_id" = "transactions"."id"',
    );
    expect(query.params).toEqual([
      'stripe',
      'pending',
      'registration',
      1_750_000_000,
    ]);
  });

  it('selects bound claims separately and reconciles only open or expired sessions', () => {
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(
      expiredBoundRegistrationClaimPredicate(1_750_000_000),
    );

    expect(query.sql).toContain(
      '"transactions"."stripeCheckoutSessionId" is not null',
    );
    expect(boundExpiredCheckoutReconciliationAction('open')).toBe('expire');
    expect(boundExpiredCheckoutReconciliationAction('expired')).toBe('cancel');
    expect(boundExpiredCheckoutReconciliationAction('complete')).toBe('skip');
    expect(boundExpiredCheckoutReconciliationAction(null)).toBe('skip');
  });

  it('selects only due unleased bound claims and backs off no later than expiry', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(
      dueBoundRegistrationCheckoutPredicate(now),
    );

    expect(query.sql).toContain(
      '"transactions"."stripe_checkout_reconcile_next_at"',
    );
    expect(query.sql).toContain(
      '"transactions"."stripe_checkout_reconcile_lease_expires_at"',
    );
    expect(query.sql).toContain(
      '"transactions"."stripeCheckoutSessionId" is not null',
    );
    expect(checkoutReconcileBackoffMs(1)).toBe(5000);
    expect(checkoutReconcileBackoffMs(20)).toBe(300_000);
    expect(
      nextRegistrationCheckoutReconcileAt({
        attempts: 4,
        expiresAt: Math.floor(now.getTime() / 1000) + 10,
        noLaterThanExpiry: true,
        now,
      }),
    ).toEqual(new Date('2026-07-10T12:00:10.000Z'));
  });

  it('leaves only unbound expired transfers to the transfer-specific pass', () => {
    const query = new PgDialect().sqlToQuery(
      expiredRegistrationTransferCheckoutCandidatePredicate(1_750_000_000),
    );

    expect(query.sql).toContain(
      '"transactions"."stripeCheckoutSessionId" is null',
    );
  });

  it.effect(
    'retrieves through the persisted account and preserves a completed Checkout',
    () =>
      Effect.gen(function* () {
        const stripe = new Stripe('sk_test_123');
        const retrieve = vi
          .spyOn(stripe.checkout.sessions, 'retrieve')
          .mockResolvedValue({
            id: 'cs_bound_1',
            status: 'complete',
          } as Stripe.Checkout.Session);
        const expire = vi.spyOn(stripe.checkout.sessions, 'expire');

        const outcome = yield* reconcileExpiredBoundRegistrationCheckout(
          {
            registrationId: 'registration-1',
            stripeAccountId: 'acct_persisted',
            stripeCheckoutSessionId: 'cs_bound_1',
            tenantId: 'tenant-1',
            transactionId: 'transaction-1',
          },
          1_750_000_000,
        ).pipe(
          Effect.provideService(Database, {} as DatabaseClient),
          Effect.provideService(StripeClient, stripe),
        );

        expect(outcome).toBe('skipped');
        expect(retrieve).toHaveBeenCalledWith('cs_bound_1', undefined, {
          stripeAccount: 'acct_persisted',
        });
        expect(expire).not.toHaveBeenCalled();
      }),
  );

  it.effect(
    'retrieves an expired transfer Checkout through its persisted account and preserves completion',
    () =>
      Effect.gen(function* () {
        const stripe = new Stripe('sk_test_123');
        const retrieve = vi
          .spyOn(stripe.checkout.sessions, 'retrieve')
          .mockResolvedValue({
            id: 'cs_transfer_1',
            status: 'complete',
          } as Stripe.Checkout.Session);
        const expire = vi.spyOn(stripe.checkout.sessions, 'expire');

        const outcome = yield* reconcileExpiredRegistrationTransferCheckout({
          registrationId: 'recipient-registration-1',
          stripeAccountId: 'acct_transfer',
          stripeCheckoutSessionId: 'cs_transfer_1',
          tenantId: 'tenant-1',
          transactionId: 'recipient-transaction-1',
          transferId: 'transfer-1',
        }).pipe(
          Effect.provideService(Database, {} as DatabaseClient),
          Effect.provideService(StripeClient, stripe),
        );

        expect(outcome).toBe('skipped');
        expect(retrieve).toHaveBeenCalledWith('cs_transfer_1', undefined, {
          stripeAccount: 'acct_transfer',
        });
        expect(expire).not.toHaveBeenCalled();
      }),
  );
});
