import { setupDatabase } from '../../src/db/setup-database';
import { test as setup } from './../fixtures/base-test';

setup('Setup database', async ({ database }) => {
  setup.setTimeout(120_000);
  await setupDatabase(database, true);
});
