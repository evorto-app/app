import type Stripe from 'stripe';

import { Effect } from 'effect';
import { DateTime } from 'luxon';

import { getServerNow } from '../clock';
import { StripeClient } from '../stripe-client';

export const buildCheckoutSessionExpiresAt = (
  expiresInMinutes = 30,
): number => {
  const pinnedNow = getServerNow();
  const wallClockNow = DateTime.now().setZone('utc');
  const baseNow =
    pinnedNow.toMillis() > wallClockNow.toMillis() ? pinnedNow : wallClockNow;
  const requestedExpiry = baseNow.plus({ minutes: expiresInMinutes });
  const stripeMaximumExpiry = wallClockNow.plus({ hours: 24 });
  const effectiveExpiry =
    requestedExpiry.toMillis() > stripeMaximumExpiry.toMillis()
      ? stripeMaximumExpiry
      : requestedExpiry;

  return Math.ceil(effectiveExpiry.toSeconds());
};

export const buildCheckoutSessionIdempotencyKey = (input: {
  registrationId: string;
  transactionId: string;
}): string =>
  `registration:${input.registrationId}:transaction:${input.transactionId}`;

export const createHostedCheckoutSession = (
  parameters: Stripe.Checkout.SessionCreateParams,
  options: {
    idempotencyKey: string;
    stripeAccount: string;
  },
): Effect.Effect<Stripe.Checkout.Session, Stripe.errors.StripeError, StripeClient> =>
  Effect.gen(function* () {
    const stripeClient = yield* StripeClient;
    return yield* Effect.tryPromise({
      catch: (error) => error as Stripe.errors.StripeError,
      try: () =>
        stripeClient.checkout.sessions.create(parameters, {
          idempotencyKey: options.idempotencyKey,
          stripeAccount: options.stripeAccount,
        }),
    });
  });
