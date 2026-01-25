import { expect } from '@playwright/test';
import { and, eq } from 'drizzle-orm';

import { adminStateFile } from '../../../../helpers/user-data';
import * as schema from '../../../../src/db/schema';
import { test as base } from '../../../fixtures/base-test';
import { takeScreenshot } from '../../../reporters/documentation-reporter';

const test = base.extend<{
  esnRegistrationId: string | null;
}>({
  esnRegistrationId: async ({ database }, use) => {
    const tenant = await database.query.tenants.findFirst({
      where: { domain: 'localhost' },
    });
    if (!tenant) {
      await use(null);
      return;
    }

    const esnRegistration = await database.query.eventRegistrations.findFirst({
      where: {
        appliedDiscountType: 'esnCard',
        status: 'CONFIRMED',
        tenantId: tenant.id,
      },
    });

    if (esnRegistration?.id) {
      await use(esnRegistration.id);
      return;
    }

    const fallbackRegistration = await database.query.eventRegistrations.findFirst({
      where: {
        status: 'CONFIRMED',
        tenantId: tenant.id,
      },
    });

    if (!fallbackRegistration?.id) {
      await use(null);
      return;
    }

    const basePrice = fallbackRegistration.basePriceAtRegistration ?? 0;
    const discountedPrice = Math.max(0, basePrice - 500);
    await database
      .update(schema.eventRegistrations)
      .set({
        appliedDiscountType: 'esnCard',
        appliedDiscountedPrice: discountedPrice,
        discountAmount: basePrice - discountedPrice,
      })
      .where(eq(schema.eventRegistrations.id, fallbackRegistration.id));

    await use(fallbackRegistration.id);
  },
});

test.use({ storageState: adminStateFile });

test('Scan view shows ESNcard discount marker', async ({ esnRegistrationId, page }, testInfo) => {
  if (!esnRegistrationId) {
    test.skip(true, 'No confirmed registration available');
    return;
  }

  await page.goto(`/scan/registration/${esnRegistrationId}`);
  await expect(page.getByRole('heading', { name: 'Registration scanned' })).toBeVisible();
  await expect(page.getByText('ESNcard discount applied')).toBeVisible();

  await takeScreenshot(
    testInfo,
    page.getByText('ESNcard discount applied'),
    page,
    'ESNcard discount marker on scanned registration',
  );
});
