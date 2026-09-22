import type Stripe from 'stripe';

import { describe, expect, it, vi } from '@effect/vitest';
import { getTableName } from 'drizzle-orm';
import { Effect } from 'effect';

import {
  eventRegistrations,
  registrationTransfers,
  tenants,
  transactions,
} from '../../db/schema';
import { StripeClient } from '../stripe-client';
import { createDatabaseTestLayer } from '../testing/database-test-layer';
import {
  createRejectingStripeClient,
  stripeCheckoutSessionResponse,
  stripePaymentIntentResponse,
} from '../testing/stripe-test-fixtures';
import {
  completePaidRegistrationCheckout,
  registrationCheckoutInitialReconcileAt,
  registrationCheckoutMetadataOwnsClaim,
  registrationCheckoutPaymentIntentId,
  registrationCheckoutPaymentOwnsClaim,
  registrationCheckoutTargetOwnsClaim,
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
}): Stripe.Checkout.Session =>
  stripeCheckoutSessionResponse({
    amount_subtotal: null,
    amount_total: 2500,
    expires_at: 1_900_000_000,
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
    url: 'https://checkout.stripe.com/c/pay/cs_persisted',
  });
const registrationPreflightDatabase = () =>
  createDatabaseTestLayer((statement, parameters) =>
    Effect.sync(() => {
      if (
        statement.startsWith('select "') &&
        statement.includes(` from "${getTableName(transactions)}"`)
      ) {
        expect(statement).toContain(
          `left join "${getTableName(registrationTransfers)}"`,
        );
        expect(statement).toContain('"recipient_checkout_transaction_id"');
        expect(statement).toContain('"stripeCheckoutSessionId"');
        expect(statement).toContain('"eventRegistrationId"');
        expect(parameters).toEqual([
          identity.transactionId,
          identity.registrationId,
          'stripe',
          identity.stripeAccountId,
          identity.stripeCheckoutSessionId,
          identity.tenantId,
          'registration',
          1,
        ]);
        return [[2500, 'EUR', null]];
      }
      if (
        statement.startsWith('select "d0".') &&
        statement.includes(` from "${getTableName(tenants)}" as "d0"`)
      ) {
        expect(statement).toContain('"d0"."id" = $1');
        expect(parameters).toEqual([identity.tenantId, 1]);
        return [
          [
            'tenant.example.com',
            'events@tenant.example.com',
            'Tenant events',
            identity.tenantId,
            'Tenant',
          ],
        ];
      }
      if (
        statement.startsWith('select "d0".') &&
        statement.includes(
          ` from "${getTableName(eventRegistrations)}" as "d0"`,
        )
      ) {
        expect(statement).toContain('"d0"."id" = $3');
        expect(statement).toContain('"d0"."tenantId" = $4');
        expect(parameters).toEqual([
          1,
          1,
          identity.registrationId,
          identity.tenantId,
          1,
        ]);
        return [
          [
            'event-1',
            identity.registrationId,
            'option-1',
            { title: 'Registration event' },
            { communicationEmail: '', email: 'participant@example.com' },
          ],
        ];
      }
      throw new Error(`Unexpected registration completion SQL: ${statement}`);
    }),
  );

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
        session,
        transferId: 'transfer-1',
      }),
    ).toBe(true);
    expect(
      registrationCheckoutMetadataOwnsClaim({
        identity,
        session,
        transferId: 'different-transfer',
      }),
    ).toBe(false);
    expect(
      registrationCheckoutMetadataOwnsClaim({
        identity,
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

  it('rejects missing ownership metadata even when the payment intent matches', () => {
    const session = checkoutSession({ metadata: {} });
    expect(
      registrationCheckoutMetadataOwnsClaim({
        identity,
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

  it('requires direct Checkout ownership while allowing an issued transfer to target its recipient', () => {
    expect(
      registrationCheckoutTargetOwnsClaim({
        registrationUserId: 'source-user',
        targetUserId: 'source-user',
        transferId: null,
      }),
    ).toBe(true);
    expect(
      registrationCheckoutTargetOwnsClaim({
        registrationUserId: 'source-user',
        targetUserId: 'recipient-user',
        transferId: 'transfer-1',
      }),
    ).toBe(true);
    expect(
      registrationCheckoutTargetOwnsClaim({
        registrationUserId: 'source-user',
        targetUserId: 'recipient-user',
        transferId: null,
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
        checkoutSession({
          paymentIntent: stripePaymentIntentResponse({
            id: 'pi_expanded',
            latest_charge: null,
          }),
        }),
      ),
    ).toBe('pi_expanded');
  });

  it.effect(
    'retrieves a string payment intent through the exact connected account and rejects a mismatched Stripe identity',
    () =>
      Effect.gen(function* () {
        const stripe = createRejectingStripeClient();
        const retrieve = vi
          .spyOn(stripe.paymentIntents, 'retrieve')
          .mockResolvedValue(
            stripePaymentIntentResponse({
              id: 'pi_foreign',
              latest_charge: 'ch_foreign',
            }),
          );

        const error = yield* completePaidRegistrationCheckout(
          identity,
          checkoutSession({
            paymentIntent: 'pi_string',
          }),
        ).pipe(
          Effect.flip,
          Effect.provide(registrationPreflightDatabase()),
          Effect.provideService(StripeClient, stripe),
        );

        expect(retrieve).toHaveBeenCalledWith(
          'pi_string',
          { expand: ['latest_charge'] },
          { stripeAccount: identity.stripeAccountId },
        );
        expect(error).toMatchObject({ kind: 'invalidBinding' });
        expect(error.message).toBe(
          'Stripe payment intent ownership does not match Checkout',
        );
      }),
  );

  it.effect(
    'maps a missing Stripe payment intent rejection to an invalid binding and preserves its cause',
    () =>
      Effect.gen(function* () {
        const stripe = createRejectingStripeClient();
        const cause = {
          raw: { code: 'resource_missing' },
          type: 'StripeInvalidRequestError',
        };
        const retrieve = vi
          .spyOn(stripe.paymentIntents, 'retrieve')
          .mockRejectedValue(cause);

        const error = yield* completePaidRegistrationCheckout(
          identity,
          checkoutSession({ paymentIntent: 'pi_missing' }),
        ).pipe(
          Effect.flip,
          Effect.provide(registrationPreflightDatabase()),
          Effect.provideService(StripeClient, stripe),
        );

        expect(retrieve).toHaveBeenCalledWith(
          'pi_missing',
          { expand: ['latest_charge'] },
          { stripeAccount: identity.stripeAccountId },
        );
        expect(error).toMatchObject({ kind: 'invalidBinding' });
        expect(error.message).toBe(
          'Stripe payment intent is missing during checkout completion',
        );
        expect(error.cause).toBe(cause);
      }),
  );

  it.effect(
    'maps an unknown Stripe payment intent rejection to an internal completion error and preserves its cause',
    () =>
      Effect.gen(function* () {
        const stripe = createRejectingStripeClient();
        const cause = new Error('Stripe is temporarily unavailable');
        vi.spyOn(stripe.paymentIntents, 'retrieve').mockRejectedValue(cause);

        const error = yield* completePaidRegistrationCheckout(
          identity,
          checkoutSession({ paymentIntent: 'pi_retry' }),
        ).pipe(
          Effect.flip,
          Effect.provide(registrationPreflightDatabase()),
          Effect.provideService(StripeClient, stripe),
        );

        expect(error).toMatchObject({ kind: 'internal' });
        expect(error.message).toBe(
          'Stripe payment intent could not be resolved during checkout completion',
        );
        expect(error.cause).toBe(cause);
      }),
  );

  it.effect(
    'rejects a completed Checkout with no payment intent before database or Stripe access',
    () =>
      Effect.gen(function* () {
        const select = vi.fn(() =>
          Effect.die(new Error('Unexpected SQL before checkout validation')),
        );
        const stripe = createRejectingStripeClient();
        const retrieve = vi.spyOn(stripe.paymentIntents, 'retrieve');

        const error = yield* completePaidRegistrationCheckout(
          identity,
          checkoutSession({ paymentIntent: null }),
        ).pipe(
          Effect.flip,
          Effect.provide(createDatabaseTestLayer(select)),
          Effect.provideService(StripeClient, stripe),
        );

        expect(error).toMatchObject({ kind: 'invalidBinding' });
        expect(error.message).toBe(
          'Registration Checkout payment intent is missing',
        );
        expect(select).not.toHaveBeenCalled();
        expect(retrieve).not.toHaveBeenCalled();
      }),
  );
});
