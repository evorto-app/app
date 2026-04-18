import { stripeApiConfig } from '@server/config/stripe-config';
import { Context, Effect, Layer } from 'effect';
import Stripe from 'stripe';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-02-25.clover';

export class StripeClient extends Context.Tag('@server/StripeClient')<
  StripeClient,
  Stripe
>() {}

export const stripeClientLayer = Layer.effect(
  StripeClient,
  stripeApiConfig.pipe(
    Effect.map(
      ({ STRIPE_API_KEY }) =>
        new Stripe(STRIPE_API_KEY, { apiVersion: STRIPE_API_VERSION }),
    ),
  ),
);
