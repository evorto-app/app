import { randEmail, randFirstName, randLastName, seed } from '@ngneat/falso';
import { reset } from 'drizzle-seed';

import { addEvents } from '../../helpers/add-events';
import { addIcons } from '../../helpers/add-icons';
import { addRoles, addUsersToRoles } from '../../helpers/add-roles';
import { addTemplateCategories } from '../../helpers/add-template-categories';
import { addTemplates } from '../../helpers/add-templates';
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
    .values(
      usersToAuthenticate
        .filter((data) => data.addToDb)
        .map((data) => ({
          auth0Id: data.authId,
          communicationEmail: randEmail(),
          email: data.email,
          firstName: randFirstName(),
          id: data.id,
          lastName: randLastName(),
        })),
    )
    .execute();

  // Setup default development tenants
  const developmentTenants = [
    { domain: 'localhost', name: 'Development' },
    { domain: 'evorto.fly.dev', name: 'Fly Deployment' },
  ];
  for (const tenant of developmentTenants) {
    const developmentTenant = await createTenant(database, tenant.domain);
    await addIcons(database, developmentTenant);
    const roles = await addRoles(database, developmentTenant);
    await addUsersToRoles(
      database,
      usersToAuthenticate
        .filter((data) => data.addToTenant && data.addToDb)
        .flatMap((data) =>
          roles.map((role) => ({ roleId: role.id, userId: data.id })),
        ),
      developmentTenant,
    );
    const categories = await addTemplateCategories(database, developmentTenant);
    const templates = await addTemplates(database, categories);
    await addEvents(database, templates);
  }
});
