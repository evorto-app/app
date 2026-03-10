import consola from 'consola';
import { Effect } from 'effect';

import { createDatabaseClient } from '../src/db/database-client';
import { setupDatabase } from '../src/db/setup-database';
import { formatConfigError } from '../src/server/config/config-error';
import { databaseConfig } from '../src/server/config/database-config';
import { makeRuntimeConfigProvider } from '../src/server/config/provider';

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

// Run the database setup with deterministic data
Effect.runPromise(
  Effect.gen(function* () {
    const runtimeConfigProvider = yield* makeRuntimeConfigProvider();
    const { DATABASE_URL } = yield* databaseConfig.pipe(
      Effect.withConfigProvider(runtimeConfigProvider),
      Effect.mapError(
        (error) =>
          new Error(
            `Invalid database configuration:\n${formatConfigError(error)}`,
          ),
      ),
    );
    const { database, pool } = createDatabaseClient(DATABASE_URL);
    try {
      yield* Effect.tryPromise(() => setupDatabase(database));
    } finally {
      yield* Effect.tryPromise(() => pool.end());
    }
  }),
).catch((error) => {
  console.error('Error setting up database:', error);
  process.exit(1);
});
