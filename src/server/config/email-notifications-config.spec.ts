import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect, Option } from 'effect';

import { formatConfigError } from './config-error';
import { emailNotificationsConfig } from './email-notifications-config';

const readEmailNotificationsConfig = (
  provider: ConfigProvider.ConfigProvider,
) =>
  emailNotificationsConfig
    .parse(provider)
    .pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid email notifications configuration:\n${formatConfigError(error)}`,
          ),
      ),
    );

const providerFromEntries = (entries: readonly (readonly [string, string])[]) =>
  ConfigProvider.fromEnv({ env: Object.fromEntries(entries) });

describe('email-notifications-config', () => {
  it.effect('keeps outbox dispatch disabled by default', () =>
    Effect.gen(function* () {
      const config = yield* readEmailNotificationsConfig(
        providerFromEntries([]),
      );

      expect(config.EMAIL_OUTBOX_DISPATCH_ENABLED).toBe(false);
      expect(config.EMAIL_FROM_ADDRESS).toEqual(Option.none());
      expect(config.RESEND_API_KEY).toEqual(Option.none());
      expect(config.EMAIL_OUTBOX_BATCH_SIZE).toBe(25);
      expect(config.EMAIL_OUTBOX_DISPATCH_INTERVAL_MS).toBe(60_000);
    }),
  );

  it.effect('captures enabled Resend dispatch settings', () =>
    Effect.gen(function* () {
      const config = yield* readEmailNotificationsConfig(
        providerFromEntries([
          ['EMAIL_FROM_ADDRESS', ' Evorto <no-reply@example.com> '],
          ['EMAIL_OUTBOX_BATCH_SIZE', '5'],
          ['EMAIL_OUTBOX_DISPATCH_ENABLED', 'true'],
          ['EMAIL_OUTBOX_DISPATCH_INTERVAL_MS', '1000'],
          ['RESEND_API_KEY', ' re_test '],
        ]),
      );

      expect(config.EMAIL_OUTBOX_DISPATCH_ENABLED).toBe(true);
      expect(config.EMAIL_FROM_ADDRESS).toEqual(
        Option.some('Evorto <no-reply@example.com>'),
      );
      expect(config.EMAIL_OUTBOX_BATCH_SIZE).toBe(5);
      expect(config.EMAIL_OUTBOX_DISPATCH_INTERVAL_MS).toBe(1000);
      expect(config.RESEND_API_KEY).toEqual(Option.some('re_test'));
    }),
  );

  it.effect('requires a sender address when dispatch is enabled', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        readEmailNotificationsConfig(
          providerFromEntries([
            ['EMAIL_OUTBOX_DISPATCH_ENABLED', 'true'],
            ['RESEND_API_KEY', 're_test'],
          ]),
        ),
      );

      expect(error.message).toContain('EMAIL_FROM_ADDRESS is required');
    }),
  );

  it.effect('requires a Resend key when dispatch is enabled', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        readEmailNotificationsConfig(
          providerFromEntries([
            ['EMAIL_FROM_ADDRESS', 'Evorto <no-reply@example.com>'],
            ['EMAIL_OUTBOX_DISPATCH_ENABLED', 'true'],
          ]),
        ),
      );

      expect(error.message).toContain('RESEND_API_KEY is required');
    }),
  );
});
