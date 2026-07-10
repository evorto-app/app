import consola from 'consola';
import { InferSelectModel } from 'drizzle-orm';

import * as oldSchema from '../../old/drizzle';
import { database } from '../../src/db';
import * as schema from '../../src/db/schema';
import {
  defaultTenantCanonicalRootUrl,
  normalizeTenantDomain,
} from '../../src/shared/tenant-public-url';

export const migrateTenant = async (
  newDomain: string,
  oldTenantData: InferSelectModel<typeof oldSchema.tenant>,
) => {
  consola.info(`Migrating tenant`);
  const normalizedDomain = normalizeTenantDomain(newDomain);
  const tenantReturn = await database
    .insert(schema.tenants)
    .values({
      canonicalRootUrl: defaultTenantCanonicalRootUrl(normalizedDomain),
      currency: oldTenantData.currency,
      domain: normalizedDomain,
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
      percentage: null,
      state: null,
      stripeTaxRateId: oldTenantData.stripeReducedTaxRate,
      tenantId: newTenant.id,
    });
  }

  return newTenant;
};
