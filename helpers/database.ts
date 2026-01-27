import { setupDatabase } from './setup-database';

/**
 * Database Seeding
 *
 * This script sets up the database with deterministic test data.
 *
 * Key features:
 * 1. Uses a day-based seed for @ngneat/falso to ensure consistent random data per day
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
setupDatabase().catch((error) => {
  console.error('Error setting up database:', error);
  process.exit(1);
});
