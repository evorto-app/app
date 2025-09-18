import { resetDatabaseSchema } from '@helpers/reset-db';
import { setupDatabase } from '@helpers/setup-database';

import * as schema from '../../src/db/schema';
import { test as setup } from './../fixtures/base-test';

setup('Setup database', async ({ database }) => {
  setup.setTimeout(120_000);
  // Reset DB and seed a single baseline tenant for this run
  await resetDatabaseSchema(database, schema);
  // Ensure base users exist BEFORE creating tenant (createTenant links users to tenant)
  await setupDatabase(database, true);
});
