import Stripe from 'stripe';

const STRIPE_API_VERSION = Stripe.API_VERSION as Stripe.LatestApiVersion;

export const createMigrationStripeClient = () => {
  const stripeApiKey = process.env['STRIPE_API_KEY'];

  if (!stripeApiKey) {
    throw new Error('STRIPE_API_KEY must be configured for Stripe migrations');
  }

  return new Stripe(stripeApiKey, { apiVersion: STRIPE_API_VERSION });
};
