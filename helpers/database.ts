import * as BunRuntime from '@effect/platform-bun/BunRuntime';
import { databaseConfig } from '@db/database-config';
import { stripeConfig } from '@server/config/stripe-config';
import consola from 'consola';
import { Config, ConfigProvider, Effect, Option, Redacted } from 'effect';

import { createDatabaseClient } from '../src/db/database-client';
import {
  resolveDatabaseSeedInputs,
  setupDatabase,
} from '../src/db/setup-database';
import { inspectStagingDatabaseInitialization } from '../src/db/staging-database-initialization';
import {
  formatConfigError,
  missingFieldError,
} from '../src/server/config/config-error';
import { makeRuntimeConfigProvider } from '../src/server/config/provider';

/**
 * Database Seeding
 *
 * This script sets up the database with deterministic test data.
 *
 * Key features:
 * 1. Uses a daily seed for @ngneat/falso to ensure consistent random data
 * 2. Creates a fixed number of events per profile
 *    - demo: richer local dataset with roughly 50 events and a gradual timeline
 *    - docs/test: stable deterministic fixtures for scenario-driven tests
 * 3. Events are created relative to the current date:
 *    - Past events (completed)
 *    - Current/upcoming approved events
 *    - Further-future draft and pending review events
 * 4. Ensures a good mix of event statuses and visibilities
 *
 * This approach provides a reliable and consistent database structure
 * for testing and development, while still making the app look like
 * it's in a plausible state of being used.
 */

const main = Effect.gen(function* () {
  const runtimeConfigProvider = yield* makeRuntimeConfigProvider();
  const config = yield* databaseConfig
    .parse(runtimeConfigProvider)
    .pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid database configuration:\n${formatConfigError(error)}`,
          ),
      ),
    );
  const { STRIPE_TEST_ACCOUNT_ID } = yield* stripeConfig
    .parse(runtimeConfigProvider)
    .pipe(
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid stripe configuration:\n${formatConfigError(error)}`,
          ),
      ),
    );
  const stripeTestAccountId = yield* Option.match(STRIPE_TEST_ACCOUNT_ID, {
    onNone: () => Effect.fail(missingFieldError('STRIPE_TEST_ACCOUNT_ID')),
    onSome: Effect.succeed,
  });
  const seedEnvironment = yield* Config.all({
    E2E_NOW_ISO: Config.option(Config.string('E2E_NOW_ISO')),
    E2E_SEED_KEY: Config.option(Config.string('E2E_SEED_KEY')),
  }).parse(
    ConfigProvider.orElse(
      ConfigProvider.fromEnv({ preserveEmptyStrings: true }),
      runtimeConfigProvider,
    ),
  );
  // Nested seed helpers read these process values. Resolve their file fallback
  // once at this CLI boundary while preserving explicit blank caller overrides.
  for (const [name, value] of Object.entries(seedEnvironment)) {
    if (Option.isSome(value)) process.env[name] = value.value;
  }
  const seedInputs = yield* Effect.try(() => resolveDatabaseSeedInputs());
  const setupOptions = { ...seedInputs, stripeTestAccountId };
  if (process.env['STAGING_SEED_PREFLIGHT_ONLY'] === 'true') {
    return;
  }

  const caCertificate = config.DATABASE_TLS_CA_CERTIFICATE.pipe(
    Option.map((certificate) => Redacted.value(certificate)),
    Option.getOrUndefined,
  );
  const tlsServerName = Option.getOrUndefined(config.DATABASE_TLS_SERVER_NAME);
  const { database, pool } = createDatabaseClient(
    config.DATABASE_URL,
    caCertificate,
    tlsServerName,
  );
  const initializeEmptyStagingOnly =
    process.env['STAGING_INITIALIZE_ONLY'] === 'true';

  yield* Effect.tryPromise(async () => {
    try {
      if (initializeEmptyStagingOnly) {
        if (process.env['APP_ENVIRONMENT'] !== 'staging') {
          throw new Error(
            'Empty staging initialization requires APP_ENVIRONMENT=staging',
          );
        }

        const initializationState =
          await inspectStagingDatabaseInitialization(pool);
        if (initializationState === 'initialized') {
          consola.info('Staging database is already initialized');
          return;
        }
        if (initializationState === 'inconsistent') {
          throw new Error(
            'Staging contains application data but no staging tenant; use the protected reset workflow',
          );
        }
      }

      await setupDatabase(database, setupOptions);
    } finally {
      await pool.end();
    }
  });
});

BunRuntime.runMain(main);
