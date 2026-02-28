import type Stripe from 'stripe';
import { DateTime } from 'luxon';

import { getServerNow } from '../clock';

interface StripeClient {
  checkout: {
    sessions: {
      create: typeof Stripe.prototype.checkout.sessions.create;
    };
  };
}

const defaultStripeClientLoader = async (): Promise<StripeClient> => {
  const { stripe } = await import('../stripe-client');
  return stripe;
};

let stripeClientLoader: () => Promise<StripeClient> = defaultStripeClientLoader;

export const __setStripeClientLoaderForTests = (
  loader: () => Promise<StripeClient>,
) => {
  stripeClientLoader = loader;
};

export const __resetStripeClientLoaderForTests = () => {
  stripeClientLoader = defaultStripeClientLoader;
};

export const buildCheckoutSessionExpiresAt = (
  expiresInMinutes = 30,
): number => {
  const pinnedNow = getServerNow();
  const wallClockNow = DateTime.now().setZone('utc');
  const baseNow =
    pinnedNow.toMillis() > wallClockNow.toMillis() ? pinnedNow : wallClockNow;

  return Math.ceil(baseNow.plus({ minutes: expiresInMinutes }).toSeconds());
};

export const buildCheckoutSessionIdempotencyKey = (input: {
  registrationId: string;
  transactionId: string;
}): string =>
  `registration:${input.registrationId}:transaction:${input.transactionId}`;

export const createHostedCheckoutSession = async (
  parameters: Stripe.Checkout.SessionCreateParams,
  options: {
    idempotencyKey: string;
    stripeAccount: string;
  },
): Promise<Stripe.Checkout.Session> => {
  const stripeClient = await stripeClientLoader();
  return stripeClient.checkout.sessions.create(parameters, {
    idempotencyKey: options.idempotencyKey,
    stripeAccount: options.stripeAccount,
  });
};
