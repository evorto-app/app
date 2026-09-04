import consola from 'consola';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { reset } from 'drizzle-seed';

import type { SeedTenantOptions } from '../../helpers/seed-tenant';
import type { SupportedTenantCurrency } from '../types/custom/tenant';

import { getSeedDate } from '../../helpers/seed-clock';
import { seedFalsoForScope } from '../../helpers/seed-falso';
import { seedBaseUsers, seedTenant } from '../../helpers/seed-tenant';
import { relations } from './relations';
import * as schema from './schema';

export type Database = NodePgDatabase<typeof relations>;

export async function setupDatabase(
  database: NodePgDatabase<typeof relations>,
  options?: {
    onlyDevelopmentTenants?: boolean;
    stripeTestAccountId?: string;
  },
) {
  return database.transaction(async (transaction) => {
    const seedDate = getSeedDate();
    const seed = seedFalsoForScope('setup-database', seedDate);
    const onlyDevelopmentTenants = options?.onlyDevelopmentTenants ?? false;
    const stripeTestAccountId = options?.stripeTestAccountId?.trim();
    consola.info(`Seeded falso with daily seed "${seed}"`);
    consola.start('Reset database schema');
    const resetStart = Date.now();
    await reset(transaction, schema);
    consola.success(`Database reset in ${Date.now() - resetStart}ms`);

    await seedBaseUsers(transaction);

    const developmentTenants: {
      currency: SupportedTenantCurrency;
      domain: string;
      name: string;
    }[] = [
      {
        currency: 'EUR',
        domain: 'localhost',
        name: 'Development',
      },
    ];
    if (!onlyDevelopmentTenants) {
      developmentTenants.push(
        {
          currency: 'EUR',
          domain: 'staging.evorto.app',
          name: 'Evorto staging',
        },
        {
          currency: 'EUR',
          domain: 'alpha.evorto.app',
          name: 'Evorto alpha',
        },
      );
    }
    for (const tenant of developmentTenants) {
      consola.start(`Seeding tenant ${tenant.domain}`);
      const tenantStart = Date.now();
      const seedOptions: SeedTenantOptions = {
        ...tenant,
        includeExampleUsers: true,
        includeRegistrations: true,
        profile: 'demo',
        seedDate,
        ...(stripeTestAccountId && { stripeAccountId: stripeTestAccountId }),
      };
      await seedTenant(transaction, seedOptions);
      consola.success(
        `Tenant ${tenant.domain} ready in ${Date.now() - tenantStart}ms`,
      );
    }
  });
}
