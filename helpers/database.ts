import { BunRuntime } from '@effect/platform-bun';
import { Effect, Option } from 'effect';

import { createDatabaseClient } from '../src/db/database-client';
import { setupDatabase } from '../src/db/setup-database';
import { formatConfigError } from '../src/server/config/config-error';
import { databaseConfig } from '../src/server/config/database-config';
import { makeRuntimeConfigProvider } from '../src/server/config/provider';
import { stripeConfig } from '../src/server/config/stripe-config';

/**
 * Database Seeding
 *
 * This script sets up the database with deterministic test data.
 *
 * Key features:
 * 1. Uses a daily seed for @ngneat/falso to ensure consistent random data
 * 2. Creates a fixed number of events (approx. 18 total)
 * 3. Events are created relative to the current date:
 *    - Past events (completed)
 *    - Current/upcoming events
 *    - Future events
 * 4. Ensures a good mix of event statuses and visibilities
 *
 * This approach provides a reliable and consistent database structure
 * for testing and development, while still making the app look like
 * it's in a plausible state of being used.
 */

const main = Effect.gen(function* () {
  const runtimeConfigProvider = yield* makeRuntimeConfigProvider();
  const { DATABASE_URL, NEON_LOCAL_PROXY } = yield* databaseConfig.pipe(
    Effect.withConfigProvider(runtimeConfigProvider),
    Effect.mapError(
      (error) =>
        new Error(
          `Invalid database configuration:\n${formatConfigError(error)}`,
        ),
    ),
  );
  const { STRIPE_TEST_ACCOUNT_ID } = yield* stripeConfig.pipe(
    Effect.withConfigProvider(runtimeConfigProvider),
    Effect.mapError(
      (error) =>
        new Error(`Invalid stripe configuration:\n${formatConfigError(error)}`),
    ),
  );
  const { database, pool } = createDatabaseClient(
    DATABASE_URL,
    NEON_LOCAL_PROXY,
  );
  try {
    yield* Effect.tryPromise(() =>
      setupDatabase(database, {
        stripeTestAccountId: Option.getOrUndefined(STRIPE_TEST_ACCOUNT_ID),
      }),
    );
  } finally {
    yield* Effect.tryPromise(() => pool.end());
  }
});

BunRuntime.runMain(main);
