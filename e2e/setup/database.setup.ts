import { reset } from 'drizzle-seed';

import { usersToAuthenticate } from '../../helpers/user-data';
import * as schema from '../../src/db/schema';
import { tenants, users } from '../../src/db/schema';
import { test as setup } from './../fixtures/base-test';

setup('reset database', async ({ database }) => {
  await reset(database, schema);
  await database
    .insert(tenants)
    .values({ domain: 'localhost', name: 'ESN Localhost' })
    .execute();
  await database
    .insert(users)
    .values(usersToAuthenticate.map((data) => ({ auth0Id: data.userId })))
    .execute();
});
