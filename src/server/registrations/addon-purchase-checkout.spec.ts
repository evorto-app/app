import type Stripe from 'stripe';

import { describe, expect, it } from '@effect/vitest';

import {
  addonPurchaseCheckoutMetadataOwnsClaim,
  addonPurchaseCheckoutPaymentOwnsClaim,
  registrationAddonPurchaseLockOrder,
  resolveAddonPurchaseTerminalTransition,
} from './addon-purchase-checkout';

describe('registration add-on purchase Checkout ownership', () => {
  const identity = {
    orderId: 'order-1',
    registrationId: 'registration-1',
    stripeAccountId: 'acct_1',
    stripeCheckoutSessionId: 'cs_1',
    tenantId: 'tenant-1',
    transactionId: 'transaction-1',
  } as const;

  it('uses optional metadata only to corroborate persisted ownership', () => {
    const exactSession = {
      metadata: {
        addonPurchaseOrderId: identity.orderId,
        registrationId: identity.registrationId,
        tenantId: identity.tenantId,
        transactionId: identity.transactionId,
      },
    } as Stripe.Checkout.Session;
    expect(
      addonPurchaseCheckoutMetadataOwnsClaim({
        identity,
        session: exactSession,
      }),
    ).toBe(true);
    expect(
      addonPurchaseCheckoutMetadataOwnsClaim({
        identity,
        session: {
          ...exactSession,
          metadata: {
            ...exactSession.metadata,
            addonPurchaseOrderId: 'other-order',
          },
        } as Stripe.Checkout.Session,
      }),
    ).toBe(false);
    expect(
      addonPurchaseCheckoutMetadataOwnsClaim({
        identity,
        session: { metadata: null } as Stripe.Checkout.Session,
      }),
    ).toBe(true);
  });

  it('requires exact amount and currency ownership', () => {
    expect(
      addonPurchaseCheckoutPaymentOwnsClaim({
        persistedAmount: 238,
        persistedCurrency: 'EUR',
        sessionAmountTotal: 238,
        sessionCurrency: 'eur',
      }),
    ).toBe(true);
    expect(
      addonPurchaseCheckoutPaymentOwnsClaim({
        persistedAmount: 238,
        persistedCurrency: 'EUR',
        sessionAmountTotal: 237,
        sessionCurrency: 'eur',
      }),
    ).toBe(false);
    expect(
      addonPurchaseCheckoutPaymentOwnsClaim({
        persistedAmount: 238,
        persistedCurrency: 'EUR',
        sessionAmountTotal: 238,
        sessionCurrency: 'czk',
      }),
    ).toBe(false);
  });

  it('makes completion and expiry mutually terminal and replay-safe', () => {
    expect(
      resolveAddonPurchaseTerminalTransition({
        orderStatus: 'pending_payment',
        registrationStatus: 'CONFIRMED',
        requested: 'complete',
        transactionStatus: 'pending',
      }),
    ).toBe('apply');
    expect(
      resolveAddonPurchaseTerminalTransition({
        orderStatus: 'completed',
        registrationStatus: 'CONFIRMED',
        requested: 'complete',
        transactionStatus: 'successful',
      }),
    ).toBe('already_applied');
    expect(
      resolveAddonPurchaseTerminalTransition({
        orderStatus: 'expired',
        registrationStatus: 'CONFIRMED',
        requested: 'complete',
        transactionStatus: 'cancelled',
      }),
    ).toBe('opposite_terminal_won');
    expect(
      resolveAddonPurchaseTerminalTransition({
        orderStatus: 'completed',
        registrationStatus: 'CONFIRMED',
        requested: 'expire',
        transactionStatus: 'successful',
      }),
    ).toBe('opposite_terminal_won');
  });

  it('documents the shared lock order used by initiation, replay, completion, and expiry', () => {
    expect(registrationAddonPurchaseLockOrder).toEqual([
      'registration',
      'active_transfer',
      'transaction',
      'order',
      'entitlement',
      'tenant_and_stock',
    ]);
  });
});
