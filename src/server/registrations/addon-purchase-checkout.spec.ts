import { describe, expect, it } from '@effect/vitest';

import { stripeCheckoutSessionResponse } from '../testing/stripe-test-fixtures';
import {
  addonPurchaseCheckoutMetadataOwnsClaim,
  addonPurchaseCheckoutPaymentOwnsClaim,
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
    const exactSession = stripeCheckoutSessionResponse({
      metadata: {
        addonPurchaseOrderId: identity.orderId,
        registrationId: identity.registrationId,
        tenantId: identity.tenantId,
        transactionId: identity.transactionId,
      },
    });
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
        },
      }),
    ).toBe(false);
    expect(
      addonPurchaseCheckoutMetadataOwnsClaim({
        identity,
        session: stripeCheckoutSessionResponse({ metadata: null }),
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
});
