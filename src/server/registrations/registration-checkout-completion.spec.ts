import { describe, expect, it, vi } from '@effect/vitest';
import { getTableName } from 'drizzle-orm';
import { Effect } from 'effect';
import Stripe from 'stripe';

import {
  eventRegistrations,
  registrationTransfers,
  tenants,
  transactions,
} from '../../db/schema';
import { StripeClient } from '../stripe-client';
import { createDatabaseTestLayer } from '../testing/database-test-layer';
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

const checkoutSessionResponse = ({
  id,
  paymentIntent,
  url,
}: {
  id: string;
  paymentIntent: Stripe.Checkout.Session['payment_intent'];
  url: string;
}): Stripe.Response<Stripe.Checkout.Session> => ({
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
  id,
  integration_identifier: null,
  invoice: null,
  invoice_creation: null,
  lastResponse: {
    headers: {},
    requestId: `req_${id}`,
    statusCode: 200,
  },
  livemode: false,
  locale: null,
  managed_payments: null,
  metadata: null,
  mode: 'payment',
  object: 'checkout.session',
  origin_context: null,
  payment_intent: paymentIntent,
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
  status: 'open',
  submit_type: null,
  subscription: null,
  success_url: null,
  total_details: null,
  ui_mode: 'hosted_page',
  url,
  wallet_options: null,
});

class UnusedStripeHttpClient extends Stripe.HttpClient {
  override getClientName() {
    return 'registration-completion-fixture';
  }
  override makeRequest() {
    return Promise.reject(
      new Error('Unexpected unmocked Stripe completion request'),
    );
  }
}
const createStripeClient = () =>
  new Stripe('sk_test_123', { httpClient: new UnusedStripeHttpClient() });
const paymentIntentResponse = (
  id: string,
  chargeId: null | string,
): Stripe.Response<Stripe.PaymentIntent> => ({
  amount: 2500,
  amount_capturable: 0,
  amount_received: 2500,
  application: null,
  application_fee_amount: null,
  automatic_payment_methods: null,
  canceled_at: null,
  cancellation_reason: null,
  capture_method: 'automatic',
  client_secret: null,
  confirmation_method: 'automatic',
  created: 1_900_000_000,
  currency: 'eur',
  customer: null,
  customer_account: null,
  description: null,
  excluded_payment_method_types: null,
  id,
  last_payment_error: null,
  lastResponse: { headers: {}, requestId: `req_${id}`, statusCode: 200 },
  latest_charge: chargeId,
  livemode: false,
  managed_payments: null,
  metadata: {},
  next_action: null,
  object: 'payment_intent',
  on_behalf_of: null,
  payment_method: null,
  payment_method_configuration_details: null,
  payment_method_options: null,
  payment_method_types: ['card'],
  processing: null,
  receipt_email: null,
  review: null,
  setup_future_usage: null,
  shipping: null,
  source: null,
  statement_descriptor: null,
  statement_descriptor_suffix: null,
  status: 'succeeded',
  transfer_group: null,
});
const checkoutSession = (input: {
  metadata?: Stripe.Metadata;
  paymentIntent?: Stripe.Checkout.Session['payment_intent'];
}): Stripe.Checkout.Session => ({
  ...checkoutSessionResponse({
    id: identity.stripeCheckoutSessionId,
    paymentIntent:
      input.paymentIntent === undefined ? 'pi_persisted' : input.paymentIntent,
    url: 'https://checkout.stripe.com/c/pay/cs_persisted',
  }),
  amount_total: 2500,
  metadata: input.metadata ?? {
    registrationId: identity.registrationId,
    tenantId: identity.tenantId,
    transactionId: identity.transactionId,
  },
  payment_status: 'paid',
  status: 'complete',
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
          paymentIntent: paymentIntentResponse('pi_expanded', null),
        }),
      ),
    ).toBe('pi_expanded');
  });

  it.effect(
    'retrieves a string payment intent through the exact connected account and rejects a mismatched Stripe identity',
    () =>
      Effect.gen(function* () {
        const stripe = createStripeClient();
        const retrieve = vi
          .spyOn(stripe.paymentIntents, 'retrieve')
          .mockResolvedValue(paymentIntentResponse('pi_foreign', 'ch_foreign'));

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
        const stripe = createStripeClient();
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
        const stripe = createStripeClient();
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
        const stripe = createStripeClient();
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
