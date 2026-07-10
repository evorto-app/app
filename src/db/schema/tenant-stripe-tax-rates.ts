import {
  boolean,
  pgTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

import { modelOfTenant } from './model';

export const tenantStripeTaxRates = pgTable(
  'tenant_stripe_tax_rates',
  {
    ...modelOfTenant,
    active: boolean('active').notNull().default(true),
    country: text(),
    displayName: text(),
    inclusive: boolean('inclusive').notNull().default(false),
    percentage: text(),
    state: text(),
    stripeTaxRateId: varchar().notNull(),
  },
  (table) => [
    uniqueIndex('tenant_stripe_tax_rates_tenant_stripe_unique').on(
      table.tenantId,
      table.stripeTaxRateId,
    ),
  ],
);
