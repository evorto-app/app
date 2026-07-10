import { describe, expect, it } from '@effect/vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { tenantStripeTaxRates } from './tenant-stripe-tax-rates';

describe('tenant Stripe tax-rate schema', () => {
  it('enforces one imported Stripe tax rate per tenant', () => {
    const tableConfig = getTableConfig(tenantStripeTaxRates);

    expect(
      tableConfig.indexes.map((candidate) => ({
        columns: candidate.config.columns.map((column) => column.name),
        name: candidate.config.name,
        unique: candidate.config.unique,
      })),
    ).toContainEqual({
      columns: ['tenantId', 'stripeTaxRateId'],
      name: 'tenant_stripe_tax_rates_tenant_stripe_unique',
      unique: true,
    });
  });
});
