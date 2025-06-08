import { addEvents } from '../../helpers/add-events';
import { addRoles, addUsersToRoles } from '../../helpers/add-roles';
import { addTemplateCategories } from '../../helpers/add-template-categories';
import { addTemplates } from '../../helpers/add-templates';
import { createTenant } from '../../helpers/create-tenant';
import { usersToAuthenticate } from '../../helpers/user-data';
import { test as base } from './base-test';

interface BaseFixtures {
  events: {
    id: string;
    registrationOptions: {
      closeRegistrationTime: Date;
      isPaid: boolean;
      openRegistrationTime: Date;
      title: string;
    }[];
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
    title: string;
    visibility: 'HIDDEN' | 'PRIVATE' | 'PUBLIC';
  }[];
  roles: {
    defaultOrganizerRole: boolean;
    defaultUserRole: boolean;
    id: string;
    name: string;
  }[];
  templateCategories: {
    id: string;
    tenantId: string;
    title: string;
  }[];
  templates: {
    description: string;
    icon: string;
    id: string;
    tenantId: string;
    title: string;
  }[];
  tenant: {
    domain: string;
    id: string;
    name: string;
  };
}

export const test = base.extend<BaseFixtures>({
  context: async ({ context, tenant }, use) => {
    await context.addCookies([
      {
        domain: 'localhost',
        expires: -1,
        name: 'evorto-tenant',
        path: '/',
        value: tenant.domain,
      },
    ]);
    await use(context);
  },

  events: [
    async ({ database, roles, templates }, use) => {
      const events = await addEvents(database, templates, roles);
      await use(events);
    },
    { auto: true },
  ],
  roles: [
    async ({ database, tenant }, use) => {
      const roles = await addRoles(database, tenant);
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
        tenant,
      );
      await use(roles);
    },
    { auto: true },
  ],
  templateCategories: async ({ database, tenant }, use) => {
    const templateCategories = await addTemplateCategories(database, tenant);
    await use(templateCategories);
  },
  templates: async ({ database, roles, templateCategories }, use) => {
    const templates = await addTemplates(database, templateCategories, roles);
    await use(templates);
  },
  tenant: async ({ database }, use) => {
    const tenant = await createTenant(database, {
      stripeAccountId: 'acct_1Qs6S5PPcz51fqyK',
    });
    base.info().annotations.push({
      description: tenant.domain,
      type: 'tenant',
    });
    await use(tenant);
  },
});
export { expect } from '@playwright/test';
