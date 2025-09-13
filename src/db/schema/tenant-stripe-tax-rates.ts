import { modelOfTenant } from '@db/schema/model';
import { boolean, pgTable, text, varchar } from 'drizzle-orm/pg-core';

export const tenantStripeTaxRates = pgTable('tenant_stripe_tax_rates', {
  ...modelOfTenant,
  active: boolean('active').notNull().default(true),
  country: text(),
  displayName: text(),
  inclusive: boolean('inclusive').notNull().default(false),
  percentage: text(),
  state: text(),
  stripeTaxRateId: varchar().notNull(),
});
