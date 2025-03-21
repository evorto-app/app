import { randEmail, randFirstName, randLastName } from '@ngneat/falso';
import consola from 'consola';
import { InferInsertModel } from 'drizzle-orm';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { reset } from 'drizzle-seed';

import { addEvents } from '../../helpers/add-events';
import { addIcons } from '../../helpers/add-icons';
import {
  addExampleUsers,
  addRoles,
  addUsersToRoles,
} from '../../helpers/add-roles';
import { addTemplateCategories } from '../../helpers/add-template-categories';
import { addTemplates } from '../../helpers/add-templates';
import { createTenant } from '../../helpers/create-tenant';
import { usersToAuthenticate } from '../../helpers/user-data';
import { database as databaseClient } from './database-client';
import { relations } from './relations';
import * as schema from './schema';
import { users } from './schema';

export async function setupDatabase(
  database: NeonDatabase<
    Record<string, never>,
    typeof relations
  > = databaseClient as unknown as NeonDatabase<
    Record<string, never>,
    typeof relations
  >,
  skipDevelopmentTenants = false,
) {
  // @ts-ignore
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

  if (skipDevelopmentTenants) return;

  // Setup default development tenants
  const developmentTenants: Partial<InferInsertModel<typeof schema.tenants>>[] =
    [
      {
        domain: 'localhost',
        name: 'Development',
        stripeAccountId: 'acct_1Qs6S5PPcz51fqyK',
      },
      {
        domain: 'evorto.fly.dev',
        name: 'Fly Deployment',
        stripeAccountId: 'acct_1Qs6S5PPcz51fqyK',
      },
      {
        domain: 'alpha.evorto.app',
        name: 'Evorto alpha',
        stripeAccountId: 'acct_1Qs6S5PPcz51fqyK',
      },
    ];
  for (const tenant of developmentTenants) {
    const developmentTenant = await createTenant(database, tenant);
    await addIcons(database, developmentTenant);
    const roles = await addRoles(database, developmentTenant);
    await addUsersToRoles(
      database,
      usersToAuthenticate
        .filter((data) => data.addToTenant && data.addToDb)
        .flatMap((data) =>
          roles
            .filter((role) => {
              if (data.roles === 'none') {
                return false;
              }
              if (data.roles === 'all') {
                return true;
              }
              if (data.roles === 'user') {
                return role.defaultUserRole;
              }
              if (data.roles === 'organizer') {
                return role.defaultUserRole || role.defaultOrganizerRole;
              }
              if (data.roles === 'admin') {
                return role.defaultUserRole || role.name === 'Admin';
              }
              return false;
            })
            .map((role) => ({ roleId: role.id, userId: data.id })),
        ),
      developmentTenant,
    );
    await addExampleUsers(database, roles, developmentTenant);
    const categories = await addTemplateCategories(database, developmentTenant);
    const templates = await addTemplates(database, categories, roles);
    await addEvents(database, templates, roles);
  }
}
