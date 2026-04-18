import { Config, Effect, Option } from 'effect';

import { missingFieldError } from './config-error';
import { optionalTrimmedString } from './config-string';

export const stripeConfig = Config.all({
  STRIPE_API_KEY: optionalTrimmedString('STRIPE_API_KEY'),
  STRIPE_TEST_ACCOUNT_ID: optionalTrimmedString('STRIPE_TEST_ACCOUNT_ID'),
  STRIPE_WEBHOOK_SECRET: optionalTrimmedString('STRIPE_WEBHOOK_SECRET'),
});

export type StripeConfig = Config.Config.Success<typeof stripeConfig>;

export const stripeApiConfig = stripeConfig.pipe(
  Effect.flatMap((config) =>
    Option.match(config.STRIPE_API_KEY, {
      onNone: () => Effect.fail(missingFieldError('STRIPE_API_KEY')),
      onSome: (apiKey) =>
        Effect.succeed({
          STRIPE_API_KEY: apiKey,
        }),
    }),
  ),
);

export const stripeWebhookConfig = stripeConfig.pipe(
  Effect.flatMap((config) =>
    Option.match(config.STRIPE_WEBHOOK_SECRET, {
      onNone: () => Effect.fail(missingFieldError('STRIPE_WEBHOOK_SECRET')),
      onSome: (webhookSecret) =>
        Effect.succeed({
          STRIPE_WEBHOOK_SECRET: webhookSecret,
        }),
    }),
  ),
);
