import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');

const expectAtomicAccountRotation = (
  source: string,
  handlerMarker: string,
  transactionMarker: string,
): void => {
  const start = source.indexOf(handlerMarker);
  const handler = source.slice(start);
  const targetFetch = handler.indexOf(
    'fetchStripeTaxRateAccountRotationTargetRates(',
  );
  const transaction = handler.indexOf(transactionMarker);
  const tenantLock = handler.indexOf(".for('update')", transaction);
  const plan = handler.indexOf('planStripeTaxRateAccountRotation(', tenantLock);
  const metadataDelete = handler.indexOf('.delete(tenantStripeTaxRates)', plan);
  const accountUpdate = handler.indexOf('.update(tenants)', metadataDelete);
  const apply = handler.indexOf(
    'applyStripeTaxRateAccountRotation(',
    accountUpdate,
  );

  expect(start).toBeGreaterThanOrEqual(0);
  expect(targetFetch).toBeGreaterThanOrEqual(0);
  expect(targetFetch).toBeLessThan(transaction);
  expect(tenantLock).toBeGreaterThan(transaction);
  expect(plan).toBeGreaterThan(tenantLock);
  expect(metadataDelete).toBeGreaterThan(plan);
  expect(accountUpdate).toBeGreaterThan(metadataDelete);
  expect(apply).toBeGreaterThan(accountUpdate);
};

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
      'const visibleTransfers =',
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

  it('serializes both tax-rate import paths on the tenant row', () => {
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

    const platform = readSource(
      '../effect/rpc/handlers/platform/platform-tenant-admin.handlers.ts',
    );
    const lockStart = platform.indexOf('const lockTargetTenant =');
    const lockEnd = platform.indexOf('export const', lockStart);
    expect(platform.slice(lockStart, lockEnd)).toContain(".for('update')");
    const platformImportStart = platform.indexOf("'platform.taxRates.import':");
    const platformImportEnd = platform.indexOf(
      "'platform.taxRates.listStripe':",
      platformImportStart,
    );
    const platformImport = platform.slice(
      platformImportStart,
      platformImportEnd,
    );
    expect(platformImport).toContain('database.transaction((transaction) =>');
    expect(platformImport).toContain('lockTargetTenant(');
    expect(platformImport).toContain('ensureStripeAccountUnchanged(');
    expect(platformImport.indexOf('lockTargetTenant(')).toBeLessThan(
      platformImport.indexOf('.insert(tenantStripeTaxRates)'),
    );
  });

  it('locks, plans, switches, and remaps both account-rotation paths atomically', () => {
    expectAtomicAccountRotation(
      readSource('../effect/rpc/handlers/admin.handlers.ts'),
      "'admin.tenant.updateSettings':",
      '.transaction((tx) =>',
    );
    expectAtomicAccountRotation(
      readSource('../effect/rpc/handlers/global-admin.handlers.ts'),
      "'globalAdmin.tenants.update':",
      'database.transaction((transaction)',
    );
  });

  it('keeps every binding remap tenant-scoped and compare-and-set', () => {
    const rotation = readSource('./stripe-tax-rate-account-rotation.ts');
    for (const [kind, endMarker, table, parentColumn, ownerTable] of [
      [
        'eventAddon',
        "case 'eventRegistrationOption':",
        'eventAddons',
        'eventId',
        'eventInstances',
      ],
      [
        'eventRegistrationOption',
        "case 'templateAddon':",
        'eventRegistrationOptions',
        'eventId',
        'eventInstances',
      ],
      [
        'templateAddon',
        "case 'templateRegistrationOption':",
        'templateEventAddons',
        'templateId',
        'eventTemplates',
      ],
      [
        'templateRegistrationOption',
        'upsertTargetRate:',
        'templateRegistrationOptions',
        'templateId',
        'eventTemplates',
      ],
    ] as const) {
      const start = rotation.indexOf(`case '${kind}':`);
      const end = rotation.indexOf(endMarker, start);
      const remap = rotation.slice(start, end);
      const normalizedRemap = remap.replaceAll(/\s+/gu, ' ');

      expect(start).toBeGreaterThanOrEqual(0);
      expect(end).toBeGreaterThan(start);
      expect(normalizedRemap).toContain(`eq(${table}.id, binding.id)`);
      expect(normalizedRemap).toContain(
        `eq(${table}.${parentColumn}, binding.parentId)`,
      );
      expect(normalizedRemap).toContain(
        `${table}.stripeTaxRateId, binding.sourceStripeTaxRateId`,
      );
      expect(normalizedRemap).toContain(`eq(${ownerTable}.tenantId, tenantId)`);
      expect(normalizedRemap).toContain(`.returning({ id: ${table}.id })`);
    }
  });
});
