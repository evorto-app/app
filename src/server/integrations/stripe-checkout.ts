import type Stripe from 'stripe';

import { Effect, Schema } from 'effect';
import { DateTime } from 'luxon';

import { getServerNow } from '../clock';
import { StripeClient } from '../stripe-client';

const stripeExpirySafetyMinutes = 5;
const stripeMinimumExpiryMinutes = 30;
export const stripeCheckoutMinimumRemainingMinutes =
  stripeMinimumExpiryMinutes + stripeExpirySafetyMinutes;

export const buildCheckoutSessionExpiresAt = (
  expiresInMinutes = 30,
  options?: {
    pinnedNowIso?: string | undefined;
  },
) => {
  const pinnedNow = getServerNow(options?.pinnedNowIso);
  const wallClockNow = DateTime.now().setZone('utc');
  const baseNow =
    pinnedNow.toMillis() > wallClockNow.toMillis() ? pinnedNow : wallClockNow;
  const requestedExpiry = baseNow.plus({ minutes: expiresInMinutes });
  const stripeMinimumExpiry = wallClockNow.plus({
    minutes: stripeCheckoutMinimumRemainingMinutes,
  });
  const stripeMaximumExpiry = wallClockNow.plus({
    hours: 24,
    minutes: -stripeExpirySafetyMinutes,
  });
  const minimumBoundedExpiry =
    requestedExpiry.toMillis() < stripeMinimumExpiry.toMillis()
      ? stripeMinimumExpiry
      : requestedExpiry;
  const effectiveExpiry =
    minimumBoundedExpiry.toMillis() > stripeMaximumExpiry.toMillis()
      ? stripeMaximumExpiry
      : minimumBoundedExpiry;

  return Math.ceil(effectiveExpiry.toSeconds());
};

export const buildCheckoutSessionIdempotencyKey = (input: {
  registrationId: string;
  transactionId: string;
}) => `registration:${input.registrationId}:transaction:${input.transactionId}`;

export class StripeCheckoutError extends Schema.TaggedErrorClass<StripeCheckoutError>()(
  'StripeCheckoutError',
  {
    cause: Schema.Defect(),
    message: Schema.String,
  },
) {}

export const createHostedCheckoutSession = Effect.fn(
  'createHostedCheckoutSession',
)(function* (
  parameters: Stripe.Checkout.SessionCreateParams,
  options: { idempotencyKey: string; stripeAccount: string },
) {
  const stripeClient = yield* StripeClient;
  return yield* Effect.tryPromise({
    catch: (cause) =>
      new StripeCheckoutError({
        cause,
        message: 'Stripe checkout session request failed',
      }),
    try: () =>
      stripeClient.checkout.sessions.create(parameters, {
        idempotencyKey: options.idempotencyKey,
        stripeAccount: options.stripeAccount,
      }),
  });
});

export const expireHostedCheckoutSession = Effect.fn(
  'expireHostedCheckoutSession',
)(function* (sessionId: string, stripeAccount: string) {
  const stripeClient = yield* StripeClient;
  return yield* Effect.tryPromise({
    catch: (cause) =>
      new StripeCheckoutError({
        cause,
        message: 'Stripe checkout session expiry failed',
      }),
    try: () =>
      stripeClient.checkout.sessions.expire(sessionId, undefined, {
        stripeAccount,
      }),
  });
});

export const retrieveHostedCheckoutSession = Effect.fn(
  'retrieveHostedCheckoutSession',
)(function* (sessionId: string, stripeAccount: string) {
  const stripeClient = yield* StripeClient;
  return yield* Effect.tryPromise({
    catch: (cause) =>
      new StripeCheckoutError({
        cause,
        message: 'Stripe checkout session retrieval failed',
      }),
    try: () =>
      stripeClient.checkout.sessions.retrieve(sessionId, undefined, {
        stripeAccount,
      }),
  });
});
