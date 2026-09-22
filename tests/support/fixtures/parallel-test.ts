import crypto from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { getId } from '../../../helpers/get-id';
import {
  seedTenant,
  type SeedTenantResult,
} from '../../../helpers/seed-tenant';
import { usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import {
  applyPermissionDiff,
  PermissionDiff,
} from '../utils/permissions-override';
import { test as base } from './base-test';
import {
  fixtureOrganizationName,
  parallelOrganizationDomain,
} from './tenant-identity';

const buildRunId = (seed: string) =>
  crypto.createHash('sha256').update(seed).digest('hex').slice(0, 10);
export const seededEsnCardIdentifier = 'DE-2026-000184';

interface BaseFixtures {
  discounts?: void;
  events: {
    id: string;
    tenantId: string;
    registrationOptions: {
      checkedInSpots: number;
      closeRegistrationTime: Date;
      confirmedSpots: number;
      id: string;
      isPaid: boolean;
      openRegistrationTime: Date;
      organizingRegistration: boolean;
      price: number;
      roleIds: string[];
      spots: number;
      stripeTaxRateId: null | string;
      title: string;
      waitlistSpots: number;
    }[];
    start: Date;
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW';
    title: string;
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
    addOns: {
      id: string;
      isPaid: boolean;
      registrationOptionIds: string[];
      title: string;
    }[];
    description: string;
    icon: string;
    id: string;
    questions: {
      id: string;
      registrationOptionKind: 'organizer' | 'participant';
      registrationOptionId: string;
      required: boolean;
      title: string;
    }[];
    seedKey:
      | 'city-tour'
      | 'city-trip'
      | 'example-config'
      | 'hike'
      | 'sports'
      | 'weekend-trip';
    tenantId: string;
    title: string;
  }[];
  tenant: SeedTenantResult['tenant'];
  tenantDomain: string;
}

export const test = base.extend<BaseFixtures & { seeded: SeedTenantResult }>({
  seeded: [
    async ({ database, falsoSeed, seedDate }, use, testInfo) => {
      const runId = buildRunId(`${falsoSeed}:retry-${testInfo.retry}`);
      const result = await seedTenant(database, {
        currency: 'EUR',
        domain: parallelOrganizationDomain(runId),
        name: fixtureOrganizationName,
        profile: 'test',
        runId,
        seedDate,
      });
      await use(result);
    },
    // Increase timeout to allow seeding events to finish in slower environments
    { auto: true, timeout: 60_000 },
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
      await applyPermissionDiff(database, tenant, diff);
    });
  },

  // Seed discount provider and a verified ESN card for the regular user
  discounts: [
    async ({ database, registerDatabaseCleanup, seedDate, tenant }, use) => {
      const currentTenant = await database.query.tenants.findFirst({
        where: { id: tenant.id },
      });
      if (!currentTenant) {
        throw new Error('Expected the seeded tenant for discount setup.');
      }
      const regularUser = usersToAuthenticate.find(
        (user) => user.roles === 'user',
      );
      if (!regularUser) {
        throw new Error('Expected the regular test user for discount setup.');
      }
      const currentUser = await database.query.users.findFirst({
        where: { id: regularUser.id },
      });
      if (!currentUser) {
        throw new Error('Expected the seeded regular user for discount setup.');
      }
      const originalCard = await database.query.userDiscountCards.findFirst({
        where: {
          tenantId: tenant.id,
          type: 'esnCard',
          userId: regularUser.id,
        },
      });
      const discountCardId = originalCard?.id ?? getId();

      // Separate callbacks keep provider restoration independent of card cleanup.
      registerDatabaseCleanup(async (cleanupDatabase) => {
        const [restoredTenant] = await cleanupDatabase
          .update(schema.tenants)
          .set({
            discountProviders: currentTenant.discountProviders,
            updatedAt: currentTenant.updatedAt,
          })
          .where(eq(schema.tenants.id, tenant.id))
          .returning({ id: schema.tenants.id });
        if (!restoredTenant) {
          throw new Error('The discount fixture tenant could not be restored.');
        }
      });
      registerDatabaseCleanup(async (cleanupDatabase) => {
        if (originalCard) {
          await cleanupDatabase
            .insert(schema.userDiscountCards)
            .values(originalCard)
            .onConflictDoUpdate({
              set: originalCard,
              target: [
                schema.userDiscountCards.userId,
                schema.userDiscountCards.tenantId,
                schema.userDiscountCards.type,
              ],
            });
          return;
        }
        await cleanupDatabase
          .delete(schema.userDiscountCards)
          .where(
            and(
              eq(schema.userDiscountCards.id, discountCardId),
              eq(schema.userDiscountCards.tenantId, tenant.id),
              eq(schema.userDiscountCards.userId, regularUser.id),
              eq(schema.userDiscountCards.type, 'esnCard'),
            ),
          );
      });

      await database
        .update(schema.tenants)
        .set({
          discountProviders: {
            ...currentTenant.discountProviders,
            esnCard: { config: {}, status: 'enabled' },
          },
        })
        .where(eq(schema.tenants.id, tenant.id));
      const validTo = new Date(seedDate.getTime() + 1000 * 60 * 60 * 24 * 180); // ~6 months
      await database
        .insert(schema.userDiscountCards)
        .values({
          id: discountCardId,
          identifier: seededEsnCardIdentifier,
          status: 'verified',
          tenantId: tenant.id,
          type: 'esnCard',
          userId: regularUser.id,
          validFrom: seedDate,
          validTo,
        })
        .onConflictDoUpdate({
          set: {
            identifier: seededEsnCardIdentifier,
            status: 'verified',
            validFrom: seedDate,
            validTo,
          },
          target: [
            schema.userDiscountCards.userId,
            schema.userDiscountCards.tenantId,
            schema.userDiscountCards.type,
          ],
        });
      await use();
    },
    { timeout: 30_000 },
  ],
});
export { expect } from '@playwright/test';
