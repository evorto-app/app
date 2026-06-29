import { stripeApiConfig } from '@server/config/stripe-config';
import { Context, Effect, Layer } from 'effect';
import Stripe from 'stripe';

type StripeConfig = NonNullable<ConstructorParameters<typeof Stripe>[1]>;

const STRIPE_API_VERSION: StripeConfig['apiVersion'] = '2026-06-24.dahlia';

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
