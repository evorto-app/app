import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  defaultStripeApplicationFeeRate,
  stripeApplicationFeeRateConfig,
  stripeWebhookConfig,
} from './stripe-config';

const readStripeWebhookConfig = (entries: readonly [string, string][]) =>
  stripeWebhookConfig.pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({ env: Object.fromEntries(entries) }),
      ),
    ),
  );

// Like the application provider, keep explicit empty strings instead of
// treating them as missing.
const readStripeApplicationFeeRate = (env: Record<string, string>) =>
  stripeApplicationFeeRateConfig.parse(
    ConfigProvider.fromEnv({ env, preserveEmptyStrings: true }),
  );

describe('stripeApplicationFeeRateConfig', () => {
  it.effect('defaults to the current 3.5 percent rate', () =>
    Effect.gen(function* () {
      expect(defaultStripeApplicationFeeRate).toBe(0.035);
      expect(yield* readStripeApplicationFeeRate({})).toBe(0.035);
    }),
  );

  it.effect('reads a configured rate', () =>
    Effect.gen(function* () {
      for (const rate of ['0', '0.05']) {
        expect(
          yield* readStripeApplicationFeeRate({
            STRIPE_APPLICATION_FEE_RATE: rate,
          }),
        ).toBe(Number(rate));
      }
    }),
  );

  it.effect('rejects rates outside zero to below one', () =>
    Effect.gen(function* () {
      for (const rate of ['-0.01', '1', '3.5']) {
        const error = yield* Effect.flip(
          readStripeApplicationFeeRate({ STRIPE_APPLICATION_FEE_RATE: rate }),
        );

        expect(error.message).toContain(
          'Expected STRIPE_APPLICATION_FEE_RATE to be at least 0 and below 1',
        );
      }
    }),
  );

  it.effect('rejects non-numeric rates', () =>
    Effect.gen(function* () {
      for (const rate of ['', 'abc', 'NaN', 'Infinity']) {
        yield* Effect.flip(
          readStripeApplicationFeeRate({ STRIPE_APPLICATION_FEE_RATE: rate }),
        );
      }
    }),
  );
});

describe('stripeWebhookConfig', () => {
  it.effect('reads webhook secret from environment', () =>
    Effect.gen(function* () {
      const config = yield* readStripeWebhookConfig([
        ['STRIPE_WEBHOOK_SECRET', 'whsec_static'],
      ]);

      expect(config.STRIPE_WEBHOOK_SECRET).toBe('whsec_static');
    }),
  );

  it.effect('prefers webhook secret file when configured', () =>
    Effect.gen(function* () {
      const directory = yield* Effect.tryPromise(() =>
        fs.mkdtemp(path.join(os.tmpdir(), 'evorto-stripe-config-')),
      );
      const secretFile = path.join(directory, 'signing-secret');
      yield* Effect.tryPromise(() =>
        fs.writeFile(secretFile, ' whsec_generated \n'),
      );

      const config = yield* readStripeWebhookConfig([
        ['STRIPE_WEBHOOK_SECRET', 'whsec_static'],
        ['STRIPE_WEBHOOK_SECRET_FILE', secretFile],
      ]).pipe(
        Effect.ensuring(
          Effect.tryPromise(() =>
            fs.rm(directory, { force: true, recursive: true }),
          ).pipe(Effect.orDie),
        ),
      );

      expect(config.STRIPE_WEBHOOK_SECRET).toBe('whsec_generated');
    }),
  );
});
