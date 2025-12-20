import consola from 'consola';
import { sql } from 'drizzle-orm';

import { database } from '../../src/db';

export const addUniqueIndexTenantStripeTaxRates = async () => {
  consola.info('Adding unique index for (tenantId, stripeTaxRateId) on tenant_stripe_tax_rates');

  try {
    // Check if index already exists
    const indexExists = await database.execute(sql`
      SELECT 1 FROM pg_indexes 
      WHERE tablename = 'tenant_stripe_tax_rates' 
      AND indexname = 'tenant_stripe_tax_rates_tenant_rate_uidx'
    `);

    if (indexExists.length > 0) {
      consola.info('Unique index already exists, skipping');
      return;
    }

    // Create the unique index
    await database.execute(sql`
      CREATE UNIQUE INDEX CONCURRENTLY tenant_stripe_tax_rates_tenant_rate_uidx 
      ON tenant_stripe_tax_rates(tenantId, stripeTaxRateId)
    `);

    consola.success('Successfully added unique index tenant_stripe_tax_rates_tenant_rate_uidx');
  } catch (error) {
    consola.error('Failed to add unique index:', error);
    throw error;
  }
};
