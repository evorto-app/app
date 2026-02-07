import consola from 'consola';
import { InferInsertModel } from 'drizzle-orm';
import { NeonDatabase } from 'drizzle-orm/neon-serverless';
import { reset } from 'drizzle-seed';

import type { SeedTenantOptions } from '../../helpers/seed-tenant';

import { getSeedDate } from '../../helpers/seed-clock';
import { seedFalsoForScope } from '../../helpers/seed-falso';
import { seedBaseUsers, seedTenant } from '../../helpers/seed-tenant';
import { database as databaseClient } from './database-client';
import { relations } from './relations';
import * as schema from './schema';

export type Database = NeonDatabase<Record<string, never>, typeof relations>;

export async function setupDatabase(
  database: NeonDatabase<
    Record<string, never>,
    typeof relations
  > = databaseClient as unknown as NeonDatabase<
    Record<string, never>,
    typeof relations
  >,
  onlyDevelopmentTenants = false,
) {
  const seedDate = getSeedDate();
  const seed = seedFalsoForScope('setup-database', seedDate);
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
    const options: SeedTenantOptions = {
      includeExampleUsers: true,
      includeRegistrations: true,
      seedDate,
    };
    if (typeof tenant.domain === 'string') {
      options.domain = tenant.domain;
    }
    if (typeof tenant.name === 'string') {
      options.name = tenant.name;
    }
    if (typeof tenant.stripeAccountId === 'string') {
      options.stripeAccountId = tenant.stripeAccountId;
    }
    await seedTenant(database, options);
    consola.success(
      `Tenant ${tenant.domain} ready in ${Date.now() - tenantStart}ms`,
    );
  }
}
