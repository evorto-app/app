import consola from 'consola';
import { eq, InferSelectModel } from 'drizzle-orm';

import * as oldSchema from '../../old/drizzle';
import { database } from '../../src/db';
import * as schema from '../../src/db/schema';

export const migrateTenant = async (
  newDomain: string,
  oldTenantData: InferSelectModel<typeof oldSchema.tenant>,
) => {
  consola.info(`Migrating tenant`);
  const tenantReturn = await database
    .insert(schema.tenants)
    .values({
      currency: oldTenantData.currency,
      domain: newDomain,
      name: oldTenantData.name,
      theme: 'esn',
    })
    .onConflictDoNothing({ target: [schema.tenants.domain] })
    .returning();
  const newTenant = tenantReturn[0];

  // If old tenant had a reduced tax rate configured, store it as the default
  // manual tax rate on the new tenant and import a minimal record for it.
  if (oldTenantData.stripeReducedTaxRate) {
    await database.insert(schema.tenantStripeTaxRates).values({
      active: true,
      displayName: null,
      inclusive: true,
      percentage: null as any,
      state: null,
      stripeTaxRateId: oldTenantData.stripeReducedTaxRate,
      tenantId: newTenant.id,
    } as any);
  }

  return newTenant;
};
