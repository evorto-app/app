import Stripe from 'stripe';

const STRIPE_API_VERSION: Stripe.LatestApiVersion = '2026-02-25.clover';

export const createMigrationStripeClient = () => {
  const stripeApiKey = process.env['STRIPE_API_KEY'];

  if (!stripeApiKey) {
    throw new Error('STRIPE_API_KEY must be configured for Stripe migrations');
  }

  return new Stripe(stripeApiKey, { apiVersion: STRIPE_API_VERSION });
};
