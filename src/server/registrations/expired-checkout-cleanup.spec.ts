import type { SQL } from 'drizzle-orm';

import { describe, expect, it, vi } from '@effect/vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { Effect } from 'effect';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Stripe from 'stripe';

import { StripeClient } from '../stripe-client';
import { createDatabaseTestLayer } from '../testing/database-test-layer';
import {
  boundExpiredCheckoutReconciliationAction,
  checkoutReconcileBackoffMs,
  claimedAddonPurchaseCheckoutPredicate,
  dueBoundAddonPurchaseCheckoutPredicate,
  dueBoundRegistrationCheckoutPredicate,
  expiredUnboundRegistrationClaimPredicate,
  nextAddonPurchaseCheckoutReconcileAt,
  nextRegistrationCheckoutReconcileAt,
  normalizeExpiredCheckoutCleanupBatchSize,
  reconcileExpiredRegistrationTransferCheckout,
} from './expired-checkout-cleanup';
import { expiredRegistrationTransferCheckoutCandidatePredicate } from './registration-transfer-finalization';

const completedTransferSession: Stripe.Response<Stripe.Checkout.Session> = {
  adaptive_pricing: null,
  after_expiration: null,
  allow_promotion_codes: null,
  amount_subtotal: null,
  amount_total: null,
  automatic_tax: {
    enabled: false,
    liability: null,
    provider: null,
    status: null,
  },
  billing_address_collection: null,
  cancel_url: null,
  client_reference_id: null,
  client_secret: null,
  collected_information: null,
  consent: null,
  consent_collection: null,
  created: 1_900_000_000,
  currency: 'eur',
  currency_conversion: null,
  custom_fields: [],
  custom_text: {
    after_submit: null,
    shipping_address: null,
    submit: null,
    terms_of_service_acceptance: null,
  },
  customer: null,
  customer_account: null,
  customer_creation: null,
  customer_details: null,
  customer_email: null,
  discounts: null,
  expires_at: 1_900_000_000,
  id: 'cs_transfer_1',
  integration_identifier: null,
  invoice: null,
  invoice_creation: null,
  lastResponse: {
    headers: {},
    requestId: 'req_cs_transfer_1',
    statusCode: 200,
  },
  livemode: false,
  locale: null,
  managed_payments: null,
  metadata: null,
  mode: 'payment',
  object: 'checkout.session',
  origin_context: null,
  payment_intent: null,
  payment_link: null,
  payment_method_collection: null,
  payment_method_configuration_details: null,
  payment_method_options: null,
  payment_method_types: ['card'],
  payment_status: 'unpaid',
  permissions: null,
  recovered_from: null,
  saved_payment_method_options: null,
  setup_intent: null,
  shipping_address_collection: null,
  shipping_cost: null,
  shipping_options: [],
  status: 'complete',
  submit_type: null,
  subscription: null,
  success_url: null,
  total_details: null,
  ui_mode: 'hosted_page',
  url: null,
  wallet_options: null,
};

const requirePredicate = (predicate: SQL | undefined) => {
  if (!predicate) throw new Error('Expected cleanup predicate');
  return predicate;
};

describe('expired checkout cleanup', () => {
  it('does not hide retry-schedule persistence failures', () => {
    const source = readFileSync(
      fileURLToPath(new URL('expired-checkout-cleanup.ts', import.meta.url)),
      'utf8',
    );

    expect(source).not.toContain('Effect.ignore');
  });

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
      requirePredicate(expiredUnboundRegistrationClaimPredicate(1_750_000_000)),
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
    expect(query.sql).toContain(
      '"transactions"."stripe_checkout_incident_session_id" is null',
    );
    expect(query.sql).toContain('jsonb_path_exists');
    expect(query.sql).toContain('$.expiresAt');
    expect(query.sql).toContain("jsonb_build_object('deadline', $4::bigint)");
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

  it('reconciles transfer sessions only when Stripe reports them open or expired', () => {
    expect(boundExpiredCheckoutReconciliationAction('open')).toBe('expire');
    expect(boundExpiredCheckoutReconciliationAction('expired')).toBe('cancel');
    expect(boundExpiredCheckoutReconciliationAction('complete')).toBe('skip');
    expect(boundExpiredCheckoutReconciliationAction(null)).toBe('skip');
  });

  it('selects only due unleased bound claims and backs off no later than expiry', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(
      requirePredicate(dueBoundRegistrationCheckoutPredicate(now)),
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

  it('matches only due unleased bound add-on Checkout claims', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const query = new PgDialect().sqlToQuery(
      requirePredicate(dueBoundAddonPurchaseCheckoutPredicate(now)),
    );

    expect(query.sql).toContain(
      '"event_registration_addon_purchase_orders"."status" =',
    );
    expect(query.sql).toContain(
      '"transactions"."stripe_checkout_request" is not null',
    );
    expect(query.sql).toContain(
      '"transactions"."stripeCheckoutSessionId" is not null',
    );
    expect(query.sql).toContain(
      '"transactions"."stripe_checkout_reconcile_next_at"',
    );
    expect(query.sql).toContain(
      '"transactions"."stripe_checkout_reconcile_lease_expires_at"',
    );
    expect(query.params).toEqual([
      'pending_payment',
      'stripe',
      'pending',
      'addon',
      now.toISOString(),
      now.toISOString(),
    ]);
  });

  it('reschedules only the worker that still owns the exact add-on lease', () => {
    const query = new PgDialect().sqlToQuery(
      requirePredicate(
        claimedAddonPurchaseCheckoutPredicate({
          attempts: 3,
          expiresAt: new Date('2026-07-10T12:30:00.000Z'),
          leaseId: 'lease-1',
          orderId: 'order-1',
          registrationId: 'registration-1',
          stripeAccountId: 'acct_1',
          stripeCheckoutSessionId: 'cs_1',
          tenantId: 'tenant-1',
          transactionId: 'transaction-1',
        }),
      ),
    );

    expect(query.params).toEqual([
      'transaction-1',
      'registration-1',
      'stripe',
      'pending',
      'acct_1',
      'lease-1',
      'cs_1',
      'tenant-1',
      'addon',
    ]);
  });

  it('backs add-on retries off by attempt and clamps only open sessions to expiry', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    const candidate = {
      attempts: 4,
      expiresAt: new Date('2026-07-10T12:00:10.000Z'),
    };

    expect(
      nextAddonPurchaseCheckoutReconcileAt(candidate, {
        noLaterThanExpiry: true,
        now,
      }),
    ).toEqual(candidate.expiresAt);
    expect(
      nextAddonPurchaseCheckoutReconcileAt(candidate, {
        noLaterThanExpiry: false,
        now,
      }),
    ).toEqual(new Date('2026-07-10T12:00:40.000Z'));
  });

  it('claims add-on Checkouts fairly with row locks and clears terminal leases', () => {
    const cleanupSource = readFileSync(
      fileURLToPath(new URL('expired-checkout-cleanup.ts', import.meta.url)),
      'utf8',
    );
    const claimStart = cleanupSource.indexOf(
      'export const claimDueBoundAddonPurchaseCheckoutCandidates',
    );
    const unboundStart = cleanupSource.indexOf(
      'const selectExpiredUnboundAddonPurchaseCheckoutCandidates',
      claimStart,
    );
    const claimSource = cleanupSource.slice(claimStart, unboundStart);

    expect(claimStart).toBeGreaterThanOrEqual(0);
    expect(unboundStart).toBeGreaterThan(claimStart);
    expect(claimSource).toContain(
      'sql`${transactions.stripeCheckoutReconcileNextAt} asc nulls first`',
    );
    expect(claimSource).toContain(
      ".for('update', { of: transactions, skipLocked: true })",
    );
    expect(claimSource).toContain('exists(');
    expect(claimSource).toContain(
      'eventRegistrationAddonPurchaseOrders.transactionId',
    );
    expect(claimSource).toContain(
      'eventRegistrationAddonPurchaseOrders.registrationId',
    );
    expect(claimSource).toContain(
      'eventRegistrationAddonPurchaseOrders.tenantId',
    );

    const checkoutSource = readFileSync(
      fileURLToPath(new URL('addon-purchase-checkout.ts', import.meta.url)),
      'utf8',
    );
    expect(
      checkoutSource.match(/stripeCheckoutReconcileLeaseExpiresAt: null/g)
        ?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(
      checkoutSource.match(/stripeCheckoutReconcileLeaseId: null/g)?.length ??
        0,
    ).toBeGreaterThanOrEqual(2);
  });

  it('leaves only unbound expired transfers to the transfer-specific pass', () => {
    const query = new PgDialect().sqlToQuery(
      requirePredicate(
        expiredRegistrationTransferCheckoutCandidatePredicate(1_750_000_000),
      ),
    );

    expect(query.sql).toContain(
      '"transactions"."stripeCheckoutSessionId" is null',
    );
    expect(query.sql).toContain("jsonb_build_object('deadline', $5::bigint)");
    expect(query.params).toEqual([
      'checkout_pending',
      'stripe',
      'pending',
      'registration',
      1_750_000_000,
    ]);
  });

  it.effect(
    'retrieves an expired transfer Checkout through its persisted account and preserves completion',
    () =>
      Effect.gen(function* () {
        const stripe = new Stripe('sk_test_123');
        const retrieve = vi
          .spyOn(stripe.checkout.sessions, 'retrieve')
          .mockResolvedValue(completedTransferSession);
        const expire = vi
          .spyOn(stripe.checkout.sessions, 'expire')
          .mockRejectedValue(new Error('Unexpected transfer Checkout expiry'));

        const outcome = yield* reconcileExpiredRegistrationTransferCheckout({
          registrationId: 'recipient-registration-1',
          stripeAccountId: 'acct_transfer',
          stripeCheckoutSessionId: 'cs_transfer_1',
          tenantId: 'tenant-1',
          transactionId: 'recipient-transaction-1',
          transferId: 'transfer-1',
        }).pipe(
          Effect.provide(createDatabaseTestLayer()),
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
