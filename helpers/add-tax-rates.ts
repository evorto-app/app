import { NodePgDatabase } from 'drizzle-orm/node-postgres';
import consola from 'consola';

import { relations } from '../src/db/relations';
import * as schema from '../src/db/schema';

/**
 * Seed imported Stripe tax rates for a tenant.
 * Rates are inclusive VAT-style and active.
 */
export const addTaxRates = async (
  database: NodePgDatabase<Record<string, never>, typeof relations>,
  tenant: { id: string },
) => {
  const seedRates: Array<{
    stripeTaxRateId: string;
    displayName: string;
    percentage: string;
  }> = [
    {
      displayName: 'VAT',
      percentage: '0',
      stripeTaxRateId: 'txr_1S6a8LPPcz51fqyK4CPonBgy',
    },
    {
      displayName: 'VAT',
      percentage: '7',
      stripeTaxRateId: 'txr_1S6a87PPcz51fqyK3gxkb7FR',
    },
    {
      displayName: 'VAT',
      percentage: '19',
      stripeTaxRateId: 'txr_1S6a7sPPcz51fqyK4AVB8NSS',
    },
  ];

  const existing = await database.query.tenantStripeTaxRates.findMany({
    where: { tenantId: tenant.id },
  });
  const existingIds = new Set(existing.map((r) => r.stripeTaxRateId));

  const toInsert = seedRates
    .filter((r) => !existingIds.has(r.stripeTaxRateId))
    .map(
      (r) =>
        ({
          active: true,
          country: null,
          displayName: r.displayName,
          inclusive: true,
          percentage: r.percentage,
          state: null,
          stripeTaxRateId: r.stripeTaxRateId,
          tenantId: tenant.id,
        }) satisfies Omit<
          typeof schema.tenantStripeTaxRates.$inferInsert,
          'id'
        >,
    );

  if (toInsert.length > 0) {
    await database.insert(schema.tenantStripeTaxRates).values(toInsert as any);
    consola.success(
      `Imported ${toInsert.length} default tax rates for tenant ${tenant.id}`,
    );
  } else {
    consola.info(`No default tax rates to import for tenant ${tenant.id}`);
  }
};
