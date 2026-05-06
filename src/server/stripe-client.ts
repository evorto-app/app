import { stripeApiConfig } from '@server/config/stripe-config';
import { Context, Effect, Layer } from 'effect';
import Stripe from 'stripe';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-02-25.clover';

export class StripeClient extends Context.Service<StripeClient, Stripe>()(
  '@server/StripeClient',
) {}

export const stripeClientLayer = Layer.effect(
  StripeClient,
  Effect.gen(function* () {
    const { STRIPE_API_KEY } = yield* stripeApiConfig;

    return new Stripe(STRIPE_API_KEY, { apiVersion: STRIPE_API_VERSION });
  }),
);
