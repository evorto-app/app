import { setupDatabase } from '../../src/db/setup-database';
import { test as setup } from './../fixtures/base-test';

setup('Setup database', async ({ database }) => {
  await setupDatabase(database, true);
});
