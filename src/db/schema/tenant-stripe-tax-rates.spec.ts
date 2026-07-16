import { describe, expect, it } from '@effect/vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';

import { tenantStripeTaxRates } from './tenant-stripe-tax-rates';

describe('tenant Stripe tax-rate schema', () => {
  it('requires account ownership with tenant-scoped provider IDs', () => {
    const tableConfig = getTableConfig(tenantStripeTaxRates);

    const indexes = tableConfig.indexes.map((candidate) => ({
      columns: candidate.config.columns.map((column) => column.name),
      name: candidate.config.name,
      unique: candidate.config.unique,
    }));

    expect(indexes).toContainEqual({
      columns: ['tenantId', 'stripeTaxRateId'],
      name: 'tenant_stripe_tax_rates_tenant_stripe_unique',
      unique: true,
    });
    expect(indexes).not.toContainEqual(
      expect.objectContaining({
        columns: ['tenantId', 'stripeAccountId', 'stripeTaxRateId'],
      }),
    );
    expect(
      tableConfig.columns.find((column) => column.name === 'stripeAccountId'),
    ).toMatchObject({ notNull: true });
  });
});
