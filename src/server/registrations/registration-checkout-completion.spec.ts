import { describe, expect, it, vi } from '@effect/vitest';
import { Effect } from 'effect';
import Stripe from 'stripe';

import { Database, type DatabaseClient } from '../../db';
import { StripeClient } from '../stripe-client';
import {
  completePaidRegistrationCheckout,
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
    payment_intent:
      input.paymentIntent === undefined ? 'pi_persisted' : input.paymentIntent,
    payment_status: 'paid',
    status: 'complete',
  }) as Stripe.Checkout.Session;

const registrationPreflightDatabase = (): DatabaseClient =>
  ({
    query: {
      eventRegistrations: {
        findFirst: () =>
          Effect.succeed({
            event: { title: 'Registration event' },
            eventId: 'event-1',
            id: identity.registrationId,
            registrationOptionId: 'option-1',
            user: {
              communicationEmail: '',
              email: 'participant@example.com',
            },
          }),
      },
      tenants: {
        findFirst: () =>
          Effect.succeed({
            domain: 'tenant.example.com',
            emailSenderEmail: 'events@tenant.example.com',
            emailSenderName: 'Tenant events',
            id: identity.tenantId,
            name: 'Tenant',
          }),
      },
    },
    select: () => ({
      from: () => ({
        leftJoin: () => ({
          where: () => ({
            limit: () =>
              Effect.succeed([
                {
                  amount: 2500,
                  currency: 'EUR',
                  persistedPaymentIntentId: null,
                  transferId: null,
                },
              ]),
          }),
        }),
      }),
    }),
  }) as DatabaseClient;

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

  it.effect(
    'retrieves a string payment intent through the exact connected account and rejects a mismatched Stripe identity',
    () =>
      Effect.gen(function* () {
        const stripe = new Stripe('sk_test_123');
        const retrieve = vi
          .spyOn(stripe.paymentIntents, 'retrieve')
          .mockResolvedValue({
            id: 'pi_foreign',
            latest_charge: 'ch_foreign',
          } as never);

        const error = yield* completePaidRegistrationCheckout(
          identity,
          checkoutSession({
            paymentIntent: 'pi_string',
          }),
        ).pipe(
          Effect.flip,
          Effect.provideService(Database, registrationPreflightDatabase()),
          Effect.provideService(StripeClient, stripe),
        );

        expect(retrieve).toHaveBeenCalledWith(
          'pi_string',
          { expand: ['latest_charge'] },
          { stripeAccount: identity.stripeAccountId },
        );
        expect(error.kind).toBe('invalidBinding');
        expect(error.message).toBe(
          'Stripe payment intent ownership does not match Checkout',
        );
      }),
  );

  it.effect(
    'rejects a completed Checkout with no payment intent before database or Stripe access',
    () =>
      Effect.gen(function* () {
        const select = vi.fn(registrationPreflightDatabase().select);
        const stripe = new Stripe('sk_test_123');
        const retrieve = vi.spyOn(stripe.paymentIntents, 'retrieve');

        const error = yield* completePaidRegistrationCheckout(
          identity,
          checkoutSession({ paymentIntent: null }),
        ).pipe(
          Effect.flip,
          Effect.provideService(Database, {
            ...registrationPreflightDatabase(),
            select,
          }),
          Effect.provideService(StripeClient, stripe),
        );

        expect(error.kind).toBe('invalidBinding');
        expect(error.message).toBe(
          'Registration Checkout payment intent is missing',
        );
        expect(select).not.toHaveBeenCalled();
        expect(retrieve).not.toHaveBeenCalled();
      }),
  );
});
