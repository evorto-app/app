import { describe, expect, it } from '@effect/vitest';
import { ConfigProvider, Effect } from 'effect';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { stripeWebhookConfig } from './stripe-config';

const readStripeWebhookConfig = (entries: readonly [string, string][]) =>
  stripeWebhookConfig.pipe(
    Effect.provide(
      ConfigProvider.layer(
        ConfigProvider.fromEnv({ env: Object.fromEntries(entries) }),
      ),
    ),
  );

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
