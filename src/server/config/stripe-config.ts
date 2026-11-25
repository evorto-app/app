import { Config, ConfigProvider, Effect, Option } from 'effect';
import fs from 'node:fs/promises';

import { missingFieldError } from './config-error';
import { optionalTrimmedString } from './config-string';

/** Share of each Stripe charge kept as the Connect application fee. */
export const defaultStripeApplicationFeeRate = 0.035;

export const stripeApplicationFeeRateConfig = Config.Finite(
  'STRIPE_APPLICATION_FEE_RATE',
).pipe(
  Config.withDefault(defaultStripeApplicationFeeRate),
  Config.mapEffect((rate) =>
    rate >= 0 && rate < 1
      ? Effect.succeed(rate)
      : Effect.fail(
          new Config.ConfigError(
            new ConfigProvider.SourceError({
              message: `Expected STRIPE_APPLICATION_FEE_RATE to be at least 0 and below 1, got ${rate}`,
            }),
          ),
        ),
  ),
);

export const stripeConfig = Config.all({
  STRIPE_API_KEY: optionalTrimmedString('STRIPE_API_KEY'),
  STRIPE_APPLICATION_FEE_RATE: stripeApplicationFeeRateConfig,
  STRIPE_TEST_ACCOUNT_ID: optionalTrimmedString('STRIPE_TEST_ACCOUNT_ID'),
  STRIPE_WEBHOOK_SECRET: optionalTrimmedString('STRIPE_WEBHOOK_SECRET'),
  STRIPE_WEBHOOK_SECRET_FILE: optionalTrimmedString(
    'STRIPE_WEBHOOK_SECRET_FILE',
  ),
});

export type StripeConfig = Config.Success<typeof stripeConfig>;

export const stripeApiConfig = Effect.gen(function* () {
  const config = yield* stripeConfig;

  return yield* Option.match(config.STRIPE_API_KEY, {
    onNone: () => Effect.fail(missingFieldError('STRIPE_API_KEY')),
    onSome: (apiKey) =>
      Effect.succeed({
        STRIPE_API_KEY: apiKey,
      }),
  });
});

export const stripeWebhookConfig = Effect.gen(function* () {
  const config = yield* stripeConfig;

  const webhookSecret = yield* Option.match(config.STRIPE_WEBHOOK_SECRET_FILE, {
    onNone: () =>
      Option.match(config.STRIPE_WEBHOOK_SECRET, {
        onNone: () => Effect.fail(missingFieldError('STRIPE_WEBHOOK_SECRET')),
        onSome: Effect.succeed,
      }),
    onSome: (filePath) =>
      Effect.tryPromise({
        catch: (cause) =>
          new Error(`Failed to read STRIPE_WEBHOOK_SECRET_FILE ${filePath}`, {
            cause: cause instanceof Error ? cause : new Error(String(cause)),
          }),
        try: () => fs.readFile(filePath, 'utf8'),
      }).pipe(
        Effect.map((value) => value.trim()),
        Effect.flatMap((value) =>
          value.length > 0
            ? Effect.succeed(value)
            : Effect.fail(missingFieldError('STRIPE_WEBHOOK_SECRET_FILE')),
        ),
      ),
  });

  return {
    STRIPE_WEBHOOK_SECRET: webhookSecret,
  };
});
