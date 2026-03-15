import consola from 'consola';
import { InferInsertModel } from 'drizzle-orm';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { reset } from 'drizzle-seed';

import type { SeedTenantOptions } from '../../helpers/seed-tenant';

import { getSeedDate } from '../../helpers/seed-clock';
import { seedFalsoForScope } from '../../helpers/seed-falso';
import { seedBaseUsers, seedTenant } from '../../helpers/seed-tenant';
import { relations } from './relations';
import * as schema from './schema';

export type Database = NodePgDatabase<Record<string, never>, typeof relations>;

export async function setupDatabase(
  database: NodePgDatabase<Record<string, never>, typeof relations>,
  options?: {
    onlyDevelopmentTenants?: boolean;
    stripeTestAccountId?: string;
  },
) {
  const seedDate = getSeedDate();
  const seed = seedFalsoForScope('setup-database', seedDate);
  const onlyDevelopmentTenants = options?.onlyDevelopmentTenants ?? false;
  const stripeTestAccountId = options?.stripeTestAccountId?.trim();
  consola.info(`Seeded falso with daily seed "${seed}"`);
  consola.start('Reset database schema');
  const resetStart = Date.now();
  await reset(database, schema);
  consola.success(`Database reset in ${Date.now() - resetStart}ms`);

  await seedBaseUsers(database);

  // Setup default development tenants
  const developmentTenants: Partial<InferInsertModel<typeof schema.tenants>>[] =
    [
      {
        domain: 'localhost',
        name: 'Development',
        ...(stripeTestAccountId
          ? { stripeAccountId: stripeTestAccountId }
          : {}),
      },
    ];
  if (!onlyDevelopmentTenants) {
    developmentTenants.push(
      {
        domain: 'evorto.fly.dev',
        name: 'Fly Deployment',
        ...(stripeTestAccountId
          ? { stripeAccountId: stripeTestAccountId }
          : {}),
      },
      {
        domain: 'alpha.evorto.app',
        name: 'Evorto alpha',
        ...(stripeTestAccountId
          ? { stripeAccountId: stripeTestAccountId }
          : {}),
      },
    );
  }
  for (const tenant of developmentTenants) {
    consola.start(`Seeding tenant ${tenant.domain}`);
    const tenantStart = Date.now();
    const seedOptions: SeedTenantOptions = {
      includeExampleUsers: true,
      includeRegistrations: true,
      profile: 'demo',
      seedDate,
    };
    if (typeof tenant.domain === 'string') {
      seedOptions.domain = tenant.domain;
    }
    if (typeof tenant.name === 'string') {
      seedOptions.name = tenant.name;
    }
    if (typeof tenant.stripeAccountId === 'string') {
      seedOptions.stripeAccountId = tenant.stripeAccountId;
    }
    await seedTenant(database, seedOptions);
    consola.success(
      `Tenant ${tenant.domain} ready in ${Date.now() - tenantStart}ms`,
    );
  }
}
