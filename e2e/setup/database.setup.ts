import { seed } from '@ngneat/falso';
import { reset } from 'drizzle-seed';

import { addTemplateCategories } from '../../helpers/add-template-categories';
import { createTenant } from '../../helpers/create-tenant';
import { usersToAuthenticate } from '../../helpers/user-data';
import * as schema from '../../src/db/schema';
import { users } from '../../src/db/schema';
import { test as setup } from './../fixtures/base-test';

setup('reset database', async ({ database }) => {
  seed('playwright');
  console.log('Seeded falso');
  await reset(database, schema);
  await database
    .insert(users)
    .values(usersToAuthenticate.map((data) => ({ auth0Id: data.userId })))
    .execute();

  // Setup default development tenant
  const developmentTenant = await createTenant(database, 'localhost');
  await addTemplateCategories(database, developmentTenant);
});
