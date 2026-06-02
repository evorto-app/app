import { Config, ConfigProvider, Effect, Option } from 'effect';

import { optionalTrimmedString } from './config-string';

const emailConfigFailure = (message: string) =>
  new Config.ConfigError(new ConfigProvider.SourceError({ message }));

const emailOutboxDispatchEnabledConfig = Config.boolean(
  'EMAIL_OUTBOX_DISPATCH_ENABLED',
).pipe(Config.withDefault(false));
const emailOutboxBatchSizeConfig = Config.int('EMAIL_OUTBOX_BATCH_SIZE').pipe(
  Config.withDefault(25),
  Config.mapOrFail((batchSize) =>
    batchSize > 0
      ? Effect.succeed(batchSize)
      : Effect.fail(
          emailConfigFailure('Expected EMAIL_OUTBOX_BATCH_SIZE to be positive'),
        ),
  ),
);
const emailOutboxDispatchIntervalMsConfig = Config.int(
  'EMAIL_OUTBOX_DISPATCH_INTERVAL_MS',
).pipe(
  Config.withDefault(60_000),
  Config.mapOrFail((intervalMs) =>
    intervalMs > 0
      ? Effect.succeed(intervalMs)
      : Effect.fail(
          emailConfigFailure(
            'Expected EMAIL_OUTBOX_DISPATCH_INTERVAL_MS to be positive',
          ),
        ),
  ),
);

export const emailNotificationsConfig = Config.all({
  EMAIL_FROM_ADDRESS: optionalTrimmedString('EMAIL_FROM_ADDRESS'),
  EMAIL_OUTBOX_BATCH_SIZE: emailOutboxBatchSizeConfig,
  EMAIL_OUTBOX_DISPATCH_ENABLED: emailOutboxDispatchEnabledConfig,
  EMAIL_OUTBOX_DISPATCH_INTERVAL_MS: emailOutboxDispatchIntervalMsConfig,
  RESEND_API_KEY: optionalTrimmedString('RESEND_API_KEY'),
}).pipe(
  Config.mapOrFail((config) => {
    if (!config.EMAIL_OUTBOX_DISPATCH_ENABLED) {
      return Effect.succeed(config);
    }

    if (Option.isNone(config.EMAIL_FROM_ADDRESS)) {
      return Effect.fail(
        emailConfigFailure(
          'EMAIL_FROM_ADDRESS is required when EMAIL_OUTBOX_DISPATCH_ENABLED is true',
        ),
      );
    }

    if (Option.isNone(config.RESEND_API_KEY)) {
      return Effect.fail(
        emailConfigFailure(
          'RESEND_API_KEY is required when EMAIL_OUTBOX_DISPATCH_ENABLED is true',
        ),
      );
    }

    return Effect.succeed(config);
  }),
);

export type EmailNotificationsConfig = Config.Success<
  typeof emailNotificationsConfig
>;
