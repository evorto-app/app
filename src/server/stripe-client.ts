import { Context, Effect, Layer } from 'effect';
import Stripe from 'stripe';

import { stripeApiConfig } from './config/stripe-config';

export class StripeClient extends Context.Tag('@server/StripeClient')<
  StripeClient,
  Stripe
>() {}

export const stripeClientLayer = Layer.effect(
  StripeClient,
  stripeApiConfig.pipe(
    Effect.map(({ STRIPE_API_KEY }) => new Stripe(STRIPE_API_KEY)),
  ),
);
