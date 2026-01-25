import { database as databaseClient } from '@db/database-client';
import { relations } from '@db/relations';
import * as schema from '@db/schema';
import { users } from '@db/schema';
import { randEmail, randFirstName, randLastName } from '@ngneat/falso';
import consola from 'consola';
import { InferInsertModel } from 'drizzle-orm';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { addEvents } from './add-events';
import { addIcons } from './add-icons';
import { addDiscountCards } from './add-discount-cards';
import { addDiscountProviders } from './add-discount-providers';
import { addRegistrations } from './add-registrations';
import { addExampleUsers, addRoles, addUsersToRoles } from './add-roles';
import { addTaxRates } from './add-tax-rates';
import { addTemplateCategories } from './add-template-categories';
import { addTemplates } from './add-templates';
import { createTenant } from './create-tenant';
import { resetDatabaseSchema } from './reset-db';
import { usersToAuthenticate } from './user-data';

export type Database = NeonDatabase<Record<string, never>, typeof relations>;

export async function setupDatabase(
  database: NeonDatabase<
    Record<string, never>,
    typeof relations
  > = databaseClient as unknown as NeonDatabase<Record<string, never>, typeof relations>,
  onlyDevelopmentTenants = false,
) {
  consola.start('Reset database schema');
  const resetStart = Date.now();
  await resetDatabaseSchema(database, schema);
  consola.success(`Database reset in ${Date.now() - resetStart}ms`);
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
  const developmentTenants: Partial<InferInsertModel<typeof schema.tenants>>[] = [
    {
      domain: 'localhost',
      name: 'Development',
      stripeAccountId: 'acct_1Qs6S5PPcz51fqyK',
    },
  ];
  if (!onlyDevelopmentTenants) {
    developmentTenants.push(
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
    );
  }
  for (const tenant of developmentTenants) {
    consola.start(`Seeding tenant ${tenant.domain}`);
    const tenantStart = Date.now();
    const developmentTenant = await createTenant(database, tenant);
    // Seed Stripe tax rates imported for this tenant
    await addTaxRates(database, developmentTenant);
    const icons = await addIcons(database, developmentTenant);
    consola.info(`Inserted ${icons.length} icons`);
    const roles = await addRoles(database, developmentTenant);
    consola.info(`Inserted ${roles.length} roles`);
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
    await addDiscountProviders(database, developmentTenant.id);
    await addDiscountCards(database, developmentTenant.id);
    const exampleUsersStart = Date.now();
    await addExampleUsers(database, roles, developmentTenant);
    consola.success(`Example users added in ${Date.now() - exampleUsersStart}ms`);
    const categories = await addTemplateCategories(database, developmentTenant, icons);
    consola.info(`Inserted ${categories.length} template categories`);
    const templates = await addTemplates(database, categories, roles);
    consola.info(`Inserted ${templates.length} templates`);
    const eventsStart = Date.now();
    const events = await addEvents(database, templates, roles);
    consola.success(`Inserted ${events.length} events in ${Date.now() - eventsStart}ms`);
    const regsStart = Date.now();
    await addRegistrations(database, events);
    consola.success(`Registrations seeded in ${Date.now() - regsStart}ms`);
    consola.success(`Tenant ${tenant.domain} ready in ${Date.now() - tenantStart}ms`);
  }
}
