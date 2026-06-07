import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  collectBrowserLogFailures,
  expectStablePageLayout,
} from '../../support/utils/page-layout';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

const viewportSizes = [
  { height: 740, label: 'narrow mobile', width: 320 },
  { height: 844, label: 'mobile', width: 390 },
  { height: 900, label: 'desktop', width: 1440 },
] as const;

test('tenant admin overview, tax, and review pages have stable layouts across viewports @admin @taxRates', async ({
  database,
  page,
  tenant,
}) => {
  const browserLogFailures = collectBrowserLogFailures(page);
  const taxRateName = `Viewport Tax ${getId().slice(0, 6)}`;
  const [taxRate] = await database
    .insert(schema.tenantStripeTaxRates)
    .values({
      active: true,
      country: 'DE',
      displayName: taxRateName,
      inclusive: true,
      percentage: '19',
      state: 'BE',
      stripeTaxRateId: `txr_viewport_${getId()}`,
      tenantId: tenant.id,
    })
    .returning({ id: schema.tenantStripeTaxRates.id });

  if (!taxRate) {
    throw new Error('Expected tax-rate viewport seed to create a rate');
  }

  const routes = [
    {
      expectedHeading: 'Admin settings',
      extraText: 'General settings',
      path: '/admin',
    },
    {
      expectedHeading: 'Tax Rates',
      extraText: taxRateName,
      path: '/admin/tax-rates',
    },
    {
      expectedHeading: 'Event Reviews',
      extraText: 'No pending reviews',
      path: '/admin/event-reviews',
    },
  ] as const;

  try {
    for (const viewport of viewportSizes) {
      await test.step(`${viewport.label} viewport`, async () => {
        await page.setViewportSize(viewport);

        for (const route of routes) {
          await test.step(route.path, async () => {
            browserLogFailures.length = 0;
            await page.goto(route.path);

            await expect(
              page.getByRole('heading', {
                level: 1,
                name: route.expectedHeading,
              }),
            ).toBeVisible();
            await expect(
              page.getByText(route.extraText, { exact: false }).first(),
            ).toBeVisible();
            await expectStablePageLayout(page);
            expect(
              browserLogFailures,
              `${viewport.label} ${route.path} should not emit browser warning/error logs`,
            ).toEqual([]);
          });
        }
      });
    }
  } finally {
    await database
      .delete(schema.tenantStripeTaxRates)
      .where(eq(schema.tenantStripeTaxRates.id, taxRate.id));
  }
});
