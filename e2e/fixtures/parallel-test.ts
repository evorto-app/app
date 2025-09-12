import { NeonDatabase } from 'drizzle-orm/neon-serverless';

import { addEvents } from '../../helpers/add-events';
import {
  addRegistrations,
  EventRegistrationInput,
} from '../../helpers/add-registrations';
import { addRoles, addUsersToRoles } from '../../helpers/add-roles';
import { addTemplateCategories } from '../../helpers/add-template-categories';
import { addIcons } from '../../helpers/add-icons';
import { addTemplates } from '../../helpers/add-templates';
import { createTenant } from '../../helpers/create-tenant';
import { usersToAuthenticate } from '../../helpers/user-data';
import { createId } from '../../src/db/create-id';
import { relations } from '../../src/db/relations';
import { test as base } from './base-test';

interface BaseFixtures {
  events: {
    id: string;
    registrationOptions: {
      closeRegistrationTime: Date;
      id: string;
      isPaid: boolean;
      openRegistrationTime: Date;
      title: string;
    }[];
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
    title: string;
    unlisted: boolean;
  }[];
  registrations: {
    eventId: string;
    id: string;
    registrationOptionId: string;
    status: 'CANCELLED' | 'CONFIRMED' | 'PENDING' | 'WAITLIST';
    tenantId: string;
    userId: string;
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
  registrations: [
    async ({ database, events, tenant }, use) => {
      // Create a minimal input format for each event with its registration options
      const eventInputs = events.map((event) => ({
        id: event.id,
        registrationOptions: event.registrationOptions.map((option) => ({
          confirmedSpots: 0,
          id: option.id,
          isPaid: option.isPaid,
          price: option.isPaid ? 1000 : 0,
          spots: 20,
        })),
        tenantId: tenant.id,
        title: event.title,
      }));

      const registrationsFromDatabase = await addRegistrations(
        database,
        eventInputs,
      );

      // Ensure all registrations have valid IDs to satisfy the fixture type
      const registrations = registrationsFromDatabase.map((reg) => ({
        eventId: reg.eventId,
        id: reg.id || createId(), // Provide fallback ID if undefined
        registrationOptionId: reg.registrationOptionId,
        status: reg.status,
        tenantId: reg.tenantId,
        userId: reg.userId,
      }));

      await use(registrations);
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
    const icons = await addIcons(database, tenant);
    const templateCategories = await addTemplateCategories(
      database,
      tenant,
      icons,
    );
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
