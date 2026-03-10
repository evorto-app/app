import { Config } from 'effect';

import { loadConfigSync } from './config-error';
import { optionalStringConfig } from './config-helpers';

export const stripeConfig = Config.all({
  STRIPE_API_KEY: optionalStringConfig('STRIPE_API_KEY'),
  STRIPE_TEST_ACCOUNT_ID: optionalStringConfig('STRIPE_TEST_ACCOUNT_ID'),
  STRIPE_WEBHOOK_SECRET: optionalStringConfig('STRIPE_WEBHOOK_SECRET'),
});

export type StripeConfig = Config.Config.Success<typeof stripeConfig>;

export const loadStripeConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): StripeConfig => loadConfigSync('stripe', stripeConfig, provider);

export const loadStripeApiConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): { STRIPE_API_KEY: string } => {
  const config = loadStripeConfigSync(provider);
  if (!config.STRIPE_API_KEY) {
    throw new Error(
      'Invalid stripe API configuration:\n- STRIPE_API_KEY: Expected STRIPE_API_KEY to be configured',
    );
  }

  return {
    STRIPE_API_KEY: config.STRIPE_API_KEY,
  };
};

export const loadStripeWebhookConfigSync = (
  provider?: import('effect').ConfigProvider.ConfigProvider,
): { STRIPE_WEBHOOK_SECRET: string } => {
  const config = loadStripeConfigSync(provider);
  if (!config.STRIPE_WEBHOOK_SECRET) {
    throw new Error(
      'Invalid stripe webhook configuration:\n- STRIPE_WEBHOOK_SECRET: Expected STRIPE_WEBHOOK_SECRET to be configured',
    );
  }

  return {
    STRIPE_WEBHOOK_SECRET: config.STRIPE_WEBHOOK_SECRET,
  };
};
