import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const expectAccountScopedTaxRateRead = (
  source: string,
  startMarker: string,
  endMarker: string,
  accountExpression: string,
): void => {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  const selection = source.slice(start, end);
  expect(selection).toContain('tenantStripeTaxRates.stripeAccountId');
  expect(selection).toContain(accountExpression);
};

describe('Stripe tax-rate account scope source guards', () => {
  it('keeps monetary add-on and transfer snapshots on the locked account', () => {
    const addonPurchase = readSource(
      '../registrations/addon-purchase.service.ts',
    );
    expectAccountScopedTaxRateRead(
      addonPurchase,
      'const taxRows =',
      'const taxRate =',
      'tenant.stripeAccountId',
    );
    const addonTaxRead = addonPurchase.slice(
      addonPurchase.indexOf('const taxRows ='),
      addonPurchase.indexOf('const taxRate ='),
    );
    expect(addonTaxRead).toContain('tenantStripeTaxRates.active, true');
    expect(addonTaxRead).toContain('tenantStripeTaxRates.inclusive, true');

    const transfer = readSource(
      '../registrations/registration-transfer.service.ts',
    );
    expectAccountScopedTaxRateRead(
      transfer,
      'const lockedTaxRates =',
      'const lockedTaxRateById =',
      'lockedStripeAccountId',
    );
    const transferTaxRead = transfer.slice(
      transfer.indexOf('const lockedTaxRates ='),
      transfer.indexOf('const lockedTaxRateById ='),
    );
    expect(transferTaxRead).toContain('tenantStripeTaxRates.active, true');
    expect(transferTaxRead).toContain('tenantStripeTaxRates.inclusive, true');
    expect(transfer).toContain(
      'lockedTaxRateById.get(taxRateId)?.percentage === null',
    );
  });

  it('keeps direct transfer and event-query metadata on the current account', () => {
    const directTransfer = readSource(
      '../effect/rpc/handlers/events/events-registration.handlers.ts',
    );
    expectAccountScopedTaxRateRead(
      directTransfer,
      'const lockedTaxRates =',
      'const taxRateById =',
      'lockedPricing.stripeAccountId',
    );
    expect(directTransfer).toContain(
      'taxRateById.get(id)?.percentage === null',
    );
    expectAccountScopedTaxRateRead(
      directTransfer,
      'const registrationAddOnOptions =',
      'const activeTransfers =',
      "tenant.stripeAccountId ?? ''",
    );

    const eventQueries = readSource(
      '../effect/rpc/handlers/events/events-query.handlers.ts',
    );
    expectAccountScopedTaxRateRead(
      eventQueries,
      'const taxRates =',
      'const taxRateByStripeId =',
      "tenant.stripeAccountId ?? ''",
    );
  });

  it('keeps standard and platform lists on their resolved current account', () => {
    const standardList = readSource(
      '../effect/rpc/handlers/tax-rates.handlers.ts',
    );
    expect(standardList).toContain(
      'const stripeAccountId = tenant.stripeAccountId',
    );
    expect(standardList).toContain('if (!stripeAccountId)');
    expect(standardList).toContain('stripeAccountId,');

    const platformEvents = readSource(
      '../effect/rpc/handlers/platform/platform-events.handlers.ts',
    );
    expectAccountScopedTaxRateRead(
      platformEvents,
      'taxRates: database',
      'templates: database',
      "operation.targetTenant.stripeAccountId ?? ''",
    );

    const platformTaxRates = readSource(
      '../effect/rpc/handlers/platform/platform-tenant-admin.handlers.ts',
    );
    expect(platformTaxRates).toContain(
      'eq(tenantStripeTaxRates.stripeAccountId, stripeAccountId)',
    );
    expect(platformTaxRates).toContain(
      'eq(tenantStripeTaxRates.stripeAccountId, stripeAccount)',
    );
    expect(platformTaxRates).toContain('stripeAccountId: stripeAccount');
  });

  it('requires exact account ownership during validation', () => {
    const validation = readSource('../utils/validate-tax-rate.ts');
    expect(validation).toContain('if (!tenant?.stripeAccountId)');
    expect(validation).toContain('stripeAccountId: tenant.stripeAccountId');
  });

  it('scopes standard imports and lists and clears metadata inside account rotation', () => {
    const admin = readSource('../effect/rpc/handlers/admin.handlers.ts');
    const importStart = admin.indexOf("'admin.tenant.importStripeTaxRates':");
    const importEnd = admin.indexOf(
      "'admin.tenant.listImportedTaxRates':",
      importStart,
    );
    const importHandler = admin.slice(importStart, importEnd);
    expect(importHandler).toContain('lockTenantStripeAccount(');
    expect(importHandler).toContain('stripeAccountId: stripeAccount');
    expect(importHandler).toContain(
      'existingRate.stripeAccountId !== stripeAccount',
    );

    const listEnd = admin.indexOf(
      "'admin.tenant.listStripeTaxRates':",
      importEnd,
    );
    const listHandler = admin.slice(importEnd, listEnd);
    expect(listHandler).toContain('if (!stripeAccountId)');
    expect(listHandler).toContain('stripeAccountId,');

    const updateStart = admin.indexOf("'admin.tenant.updateSettings':");
    const updateHandler = admin.slice(updateStart);
    const paidGuard = updateHandler.indexOf(
      'tenantHasPaidEventConfiguration(tx, tenant.id)',
    );
    const metadataDelete = updateHandler.indexOf(
      '.delete(tenantStripeTaxRates)',
    );
    const accountUpdate = updateHandler.indexOf('.update(tenants)');
    expect(paidGuard).toBeGreaterThanOrEqual(0);
    expect(metadataDelete).toBeGreaterThan(paidGuard);
    expect(accountUpdate).toBeGreaterThan(metadataDelete);
  });

  it('clears every tenant tax metadata row in the global-admin rotation transaction', () => {
    const source = readSource(
      '../effect/rpc/handlers/global-admin.handlers.ts',
    );
    const updateStart = source.indexOf("'globalAdmin.tenants.update':");
    const update = source.slice(updateStart);
    const paidGuard = update.indexOf(
      'tenantHasPaidEventConfiguration(transaction, id)',
    );
    const metadataDelete = update.indexOf('.delete(tenantStripeTaxRates)');
    const tenantUpdate = update.indexOf('.update(tenants)');

    expect(paidGuard).toBeGreaterThanOrEqual(0);
    expect(metadataDelete).toBeGreaterThan(paidGuard);
    expect(tenantUpdate).toBeGreaterThan(metadataDelete);
    expect(update.slice(metadataDelete, tenantUpdate)).toContain(
      '.where(eq(tenantStripeTaxRates.tenantId, id))',
    );
  });
});
