import { describe, expect, it, vi } from '@effect/vitest';
import { Effect } from 'effect';

import { StripeClient } from '../stripe-client';
import { createDatabaseTestLayer } from '../testing/database-test-layer';
import {
  createRejectingStripeClient,
  stripeCheckoutSessionResponse,
} from '../testing/stripe-test-fixtures';
import {
  boundExpiredCheckoutReconciliationAction,
  checkoutReconcileBackoffMs,
  nextAddonPurchaseCheckoutReconcileAt,
  nextRegistrationCheckoutReconcileAt,
  normalizeExpiredCheckoutCleanupBatchSize,
  reconcileExpiredRegistrationTransferCheckout,
} from './expired-checkout-cleanup';

const completedTransferSession = stripeCheckoutSessionResponse({
  amount_subtotal: null,
  amount_total: null,
  expires_at: 1_900_000_000,
  id: 'cs_transfer_1',
  metadata: null,
  payment_intent: null,
  payment_status: 'unpaid',
  status: 'complete',
  url: null,
});

describe('expired checkout cleanup', () => {
  it('keeps every sweep within the configured batch bound', () => {
    expect(normalizeExpiredCheckoutCleanupBatchSize()).toBe(25);
    expect(normalizeExpiredCheckoutCleanupBatchSize(0)).toBe(1);
    expect(normalizeExpiredCheckoutCleanupBatchSize(12.9)).toBe(12);
    expect(normalizeExpiredCheckoutCleanupBatchSize(1000)).toBe(100);
    expect(normalizeExpiredCheckoutCleanupBatchSize(NaN)).toBe(25);
  });

  it('reconciles transfer sessions only when Stripe reports them open or expired', () => {
    expect(boundExpiredCheckoutReconciliationAction('open')).toBe('expire');
    expect(boundExpiredCheckoutReconciliationAction('expired')).toBe('cancel');
    expect(boundExpiredCheckoutReconciliationAction('complete')).toBe('skip');
    expect(boundExpiredCheckoutReconciliationAction(null)).toBe('skip');
  });

  it('backs registration retries off no later than expiry', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
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

  it.effect(
    'retrieves an expired transfer Checkout through its persisted account and preserves completion',
    () =>
      Effect.gen(function* () {
        const stripe = createRejectingStripeClient();
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
