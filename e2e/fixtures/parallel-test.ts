import { eq } from 'drizzle-orm';

import { addEvents } from '../../helpers/add-events';
import { addIcons } from '../../helpers/add-icons';
import { addRegistrations } from '../../helpers/add-registrations';
import { addRoles, addUsersToRoles } from '../../helpers/add-roles';
import { addTemplateCategories } from '../../helpers/add-template-categories';
import { addTemplates } from '../../helpers/add-templates';
import { createTenant } from '../../helpers/create-tenant';
import { usersToAuthenticate } from '../../helpers/user-data';
import { createId } from '../../src/db/create-id';
import * as schema from '../../src/db/schema';
import {
  applyPermissionDiff,
  PermissionDiff,
} from '../utils/permissions-override';
import { test as base } from './base-test';

interface BaseFixtures {
  discounts?: void;
  events: {
    end: Date;
    id: string;
    registrationOptions: {
      closeRegistrationTime: Date;
      description?: null | string;
      discounts?:
        | null
        | {
            discountedPrice: number;
            discountType: 'esnCard';
          }[];
      id: string;
      isPaid: boolean;
      openRegistrationTime: Date;
      organizingRegistration: boolean;
      price?: null | number;
      title: string;
    }[];
    start: Date;
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
    tenantId?: string;
    title: string;
    unlisted: boolean;
  }[];
  permissionOverride: (diff: PermissionDiff) => Promise<void>;
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

interface ParallelOptions {
  seedDiscounts: boolean;
}

export const test = base.extend<BaseFixtures & ParallelOptions>({
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
  // Seed discount provider and a verified ESNcard for the regular user
  discounts: async ({ database, seedDiscounts, tenant }, use) => {
    if (!seedDiscounts) {
      await use();
      return;
    }
    // Enable ESN provider for tenant (stored on tenant model)
    const currentTenant = await database.query.tenants.findFirst({
      where: { id: tenant.id },
    });
    const current = ((currentTenant as any)?.discountProviders ?? {}) as Record<
      string,
      { config: unknown; status: 'disabled' | 'enabled' }
    >;
    const updated = {
      ...current,
      esnCard: { config: {}, status: 'enabled' },
    };
    await database
      .update(schema.tenants)
      .set({ discountProviders: updated as any })
      .where(eq(schema.tenants.id, tenant.id));
    const regularUser = usersToAuthenticate.find((u) => u.roles === 'user');
    if (regularUser) {
      const uniqueIdentifier = `TEST-ESN-0001-${tenant.id.slice(0, 6)}`;
      await database.insert(schema.userDiscountCards).values({
        identifier: uniqueIdentifier,
        status: 'verified',
        tenantId: tenant.id,
        type: 'esnCard',
        userId: regularUser.id,
        validFrom: new Date(),
        validTo: new Date(Date.now() + 1000 * 60 * 60 * 24 * 180), // ~6 months
      });
    }
    await use();
  },

  events: [
    async ({ database, roles, templates }, use) => {
      const events = await addEvents(database, templates, roles);
      await use(events);
    },
    // Increase timeout to allow seeding events to finish in slower environments
    { auto: true, timeout: 20_000 },
  ],
  permissionOverride: async ({ database, tenant }, use) => {
    await use(async (diff: PermissionDiff) => {
      await applyPermissionDiff(database as any, tenant, diff);
    });
  },
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
          roleIds: option.roleIds ?? [],
          spots: 20,
        })),
        start: event.start as unknown as Date,
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
  seedDiscounts: [true, { option: true }],
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
