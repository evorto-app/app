import type Stripe from 'stripe';

import { describe, expect, it } from '@effect/vitest';

import {
  registrationCheckoutInitialReconcileAt,
  registrationCheckoutMetadataOwnsClaim,
  registrationCheckoutPaymentIntentId,
  registrationCheckoutPaymentOwnsClaim,
} from './registration-checkout-completion';

const identity = {
  registrationId: 'registration-1',
  stripeAccountId: 'acct_persisted',
  stripeCheckoutSessionId: 'cs_persisted',
  tenantId: 'tenant-1',
  transactionId: 'transaction-1',
} as const;

const checkoutSession = (input: {
  metadata?: Stripe.Metadata;
  paymentIntent?: Stripe.Checkout.Session['payment_intent'];
}) =>
  ({
    amount_total: 2500,
    currency: 'eur',
    id: identity.stripeCheckoutSessionId,
    metadata: input.metadata ?? {
      registrationId: identity.registrationId,
      tenantId: identity.tenantId,
      transactionId: identity.transactionId,
    },
    payment_intent: input.paymentIntent ?? 'pi_persisted',
  }) as Stripe.Checkout.Session;

describe('registration Checkout completion ownership', () => {
  it('schedules a newly bound Checkout shortly after binding', () => {
    const now = new Date('2026-07-10T12:00:00.000Z');
    expect(registrationCheckoutInitialReconcileAt(now)).toEqual(
      new Date('2026-07-10T12:00:05.000Z'),
    );
  });

  it('accepts only the exact registration, tenant, transaction, and transfer metadata', () => {
    const session = checkoutSession({
      metadata: {
        registrationId: identity.registrationId,
        tenantId: identity.tenantId,
        transactionId: identity.transactionId,
        transferId: 'transfer-1',
      },
    });
    expect(
      registrationCheckoutMetadataOwnsClaim({
        identity,
        paymentIntentId: 'pi_persisted',
        persistedPaymentIntentId: null,
        session,
        transferId: 'transfer-1',
      }),
    ).toBe(true);
    expect(
      registrationCheckoutMetadataOwnsClaim({
        identity,
        paymentIntentId: 'pi_persisted',
        persistedPaymentIntentId: null,
        session,
        transferId: 'different-transfer',
      }),
    ).toBe(false);
    expect(
      registrationCheckoutMetadataOwnsClaim({
        identity,
        paymentIntentId: 'pi_persisted',
        persistedPaymentIntentId: null,
        session: checkoutSession({
          metadata: {
            registrationId: 'replayed-registration',
            tenantId: identity.tenantId,
            transactionId: identity.transactionId,
          },
        }),
        transferId: null,
      }),
    ).toBe(false);
  });

  it('allows missing metadata only through the exact persisted payment intent mapping', () => {
    const session = checkoutSession({ metadata: {} });
    expect(
      registrationCheckoutMetadataOwnsClaim({
        identity,
        paymentIntentId: 'pi_persisted',
        persistedPaymentIntentId: 'pi_persisted',
        session,
        transferId: null,
      }),
    ).toBe(true);
    expect(
      registrationCheckoutMetadataOwnsClaim({
        identity,
        paymentIntentId: 'pi_replayed',
        persistedPaymentIntentId: 'pi_persisted',
        session,
        transferId: null,
      }),
    ).toBe(false);
  });

  it('fails closed unless Stripe gross amount and currency exactly own the persisted claim', () => {
    expect(
      registrationCheckoutPaymentOwnsClaim({
        persistedAmount: 2500,
        persistedCurrency: 'EUR',
        sessionAmountTotal: 2500,
        sessionCurrency: 'eur',
      }),
    ).toBe(true);
    expect(
      registrationCheckoutPaymentOwnsClaim({
        persistedAmount: 2500,
        persistedCurrency: 'EUR',
        sessionAmountTotal: 2499,
        sessionCurrency: 'eur',
      }),
    ).toBe(false);
    expect(
      registrationCheckoutPaymentOwnsClaim({
        persistedAmount: 2500,
        persistedCurrency: 'EUR',
        sessionAmountTotal: 2500,
        sessionCurrency: 'usd',
      }),
    ).toBe(false);
    expect(
      registrationCheckoutPaymentOwnsClaim({
        persistedAmount: 2500,
        persistedCurrency: 'EUR',
        sessionAmountTotal: null,
        sessionCurrency: null,
      }),
    ).toBe(false);
  });

  it('derives payment intent ownership from either Stripe representation', () => {
    expect(
      registrationCheckoutPaymentIntentId(
        checkoutSession({ paymentIntent: 'pi_string' }),
      ),
    ).toBe('pi_string');
    expect(
      registrationCheckoutPaymentIntentId(
        checkoutSession({ paymentIntent: { id: 'pi_expanded' } as never }),
      ),
    ).toBe('pi_expanded');
  });
});
