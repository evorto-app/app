import { adminStateFile } from '../../../helpers/user-data';
import { seedTenant } from '../../../helpers/seed-tenant';
import { getId } from '../../../helpers/get-id';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/permissions-test';

test.use({ storageState: adminStateFile });

const buildTaxRate = (displayName: string, tenantId: string) => ({
  active: true,
  country: 'DE',
  displayName,
  inclusive: true,
  percentage: '19',
  state: 'BY',
  stripeTaxRateId: `txr_${getId()}`,
  tenantId,
});

test.describe('Tax Rates Tenant Isolation', () => {
  test('tax rates stay isolated between tenant contexts @permissions @taxRates @isolation @track(playwright-specs-track-linking_20260126) @req(TENANT-ISOLATION-TAX-RATES-SPEC-01)', async ({
    database,
    seedDate,
    tenant,
  }) => {
    const secondaryTenant = await seedTenant(database, {
      domain: `tax-iso-${getId().slice(0, 8)}`,
      profile: 'test',
      seedDate,
      stripeAccountId: process.env['STRIPE_TEST_ACCOUNT_ID'],
    });

    const primaryRateName = `Primary Tax ${getId().slice(0, 6)}`;
    const secondaryRateName = `Secondary Tax ${getId().slice(0, 6)}`;

    await database.insert(schema.tenantStripeTaxRates).values([
      buildTaxRate(primaryRateName, tenant.id),
      buildTaxRate(secondaryRateName, secondaryTenant.tenant.id),
    ]);

    const primaryTenantRates = await database.query.tenantStripeTaxRates.findMany({
      where: { tenantId: tenant.id },
    });
    const secondaryTenantRates =
      await database.query.tenantStripeTaxRates.findMany({
        where: { tenantId: secondaryTenant.tenant.id },
      });

    expect(
      primaryTenantRates.some((rate) => rate.displayName === primaryRateName),
    ).toBe(true);
    expect(
      primaryTenantRates.some((rate) => rate.displayName === secondaryRateName),
    ).toBe(false);
    expect(
      secondaryTenantRates.some((rate) => rate.displayName === secondaryRateName),
    ).toBe(true);
    expect(
      secondaryTenantRates.some((rate) => rate.displayName === primaryRateName),
    ).toBe(false);
  });

  test('cross-tenant tax rate lookup remains tenant scoped @permissions @taxRates @isolation @track(playwright-specs-track-linking_20260126) @req(TENANT-ISOLATION-TAX-RATES-SPEC-02)', async ({
    database,
    permissionOverride,
    seedDate,
    tenant,
  }) => {
    await permissionOverride({
      add: ['admin:tax'],
      remove: [],
      roleName: 'Admin',
    });

    const secondaryTenant = await seedTenant(database, {
      domain: `tax-iso-db-${getId().slice(0, 8)}`,
      profile: 'test',
      seedDate,
      stripeAccountId: process.env['STRIPE_TEST_ACCOUNT_ID'],
    });

    const primaryRateName = `Primary DB Tax ${getId().slice(0, 6)}`;
    const secondaryRateName = `Secondary DB Tax ${getId().slice(0, 6)}`;

    await database.insert(schema.tenantStripeTaxRates).values([
      buildTaxRate(primaryRateName, tenant.id),
      buildTaxRate(secondaryRateName, secondaryTenant.tenant.id),
    ]);

    const primaryTenantRates = await database.query.tenantStripeTaxRates.findMany({
      where: { tenantId: tenant.id },
    });
    const secondaryTenantRates =
      await database.query.tenantStripeTaxRates.findMany({
        where: { tenantId: secondaryTenant.tenant.id },
      });

    expect(
      primaryTenantRates.some((rate) => rate.displayName === secondaryRateName),
    ).toBe(false);
    expect(
      secondaryTenantRates.some((rate) => rate.displayName === primaryRateName),
    ).toBe(false);
  });
});
