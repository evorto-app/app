import { eq } from 'drizzle-orm';

import { getId } from '../../helpers/get-id';
import { seedTenant, type SeedTenantResult } from '../../helpers/seed-tenant';
import { usersToAuthenticate } from '../../helpers/user-data';
import * as schema from '../../src/db/schema';
import {
  applyPermissionDiff,
  PermissionDiff,
} from '../utils/permissions-override';
import { test as base } from './base-test';

interface BaseFixtures {
  discounts?: void;
  events: {
    id: string;
    tenantId: string;
    registrationOptions: {
      closeRegistrationTime: Date;
      id: string;
      isPaid: boolean;
      openRegistrationTime: Date;
      price: number;
      roleIds: string[];
      spots: number;
      title: string;
    }[];
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
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
  tenantDomain: string;
}

export const test = base.extend<BaseFixtures & { seeded: SeedTenantResult }>({
  seeded: [
    async ({ database, falsoSeed, seedDate }, use) => {
      void falsoSeed;
      const runId = getId().slice(0, 10);
      const result = await seedTenant(database, {
        domain: `e2e-${runId}`,
        runId,
        seedDate,
      });
      await use(result);
    },
    // Increase timeout to allow seeding events to finish in slower environments
    { auto: true, timeout: 20_000 },
  ],
  tenant: async ({ seeded }, use) => {
    await use(seeded.tenant);
  },
  tenantDomain: async ({ tenant }, use) => {
    await use(tenant.domain);
  },
  roles: async ({ seeded }, use) => {
    await use(seeded.roles);
  },
  templateCategories: async ({ seeded }, use) => {
    await use(seeded.templateCategories);
  },
  templates: async ({ seeded }, use) => {
    await use(seeded.templates);
  },
  events: async ({ seeded }, use) => {
    await use(seeded.events);
  },
  registrations: async ({ seeded }, use) => {
    await use(seeded.registrations);
  },
  permissionOverride: async ({ database, tenant }, use) => {
    await use(async (diff: PermissionDiff) => {
      await applyPermissionDiff(database as any, tenant, diff);
    });
  },

  // Seed discount provider and a verified ESN card for the regular user
  discounts: [
    async ({ database, tenant }, use) => {
      // Enable ESN provider for tenant (stored on tenant model)
      const currentTenant = await database.query.tenants.findFirst({
        where: { id: tenant.id },
      });
      const current = ((currentTenant as any)?.discountProviders ??
        {}) as Record<
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
    { auto: true },
  ],
});
export { expect } from '@playwright/test';
