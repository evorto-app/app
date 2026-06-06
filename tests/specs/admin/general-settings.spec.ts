import { expect } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import { test } from '../../support/fixtures/base-test';
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

test('tenant admin general settings has stable layouts across viewports @admin', async ({
  page,
  tenantDomain,
}) => {
  const browserLogFailures = collectBrowserLogFailures(page);
  const currentTenantDomain = tenantDomain ?? 'localhost';

  for (const viewport of viewportSizes) {
    await test.step(`${viewport.label} viewport`, async () => {
      browserLogFailures.length = 0;
      await page.setViewportSize(viewport);
      await page.goto('/admin/settings');

      const generalSettings = page.locator('app-general-settings');
      await expect(
        generalSettings.getByRole('heading', { name: 'General settings' }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Deferred settings' }),
      ).toBeVisible();
      await expect(
        page.getByRole('heading', { name: 'Tenant identity' }),
      ).toBeVisible();
      await expect(page.getByText(currentTenantDomain)).toBeVisible();

      await expectStablePageLayout(page);
      expect(
        browserLogFailures,
        `${viewport.label} tenant General settings should not emit browser warning/error logs`,
      ).toEqual([]);
    });
  }
});

test('tenant admin updates relaunch general settings @admin', async ({
  database,
  page,
  seedDate,
  tenantDomain,
}) => {
  const currentTenantDomain = tenantDomain ?? 'localhost';
  const tenant = await database.query.tenants.findFirst({
    where: (tenantTable) => eq(tenantTable.domain, currentTenantDomain),
  });
  if (!tenant) {
    throw new Error(`Expected tenant row for ${currentTenantDomain}`);
  }
  const suffix = seedDate.getTime();
  const logoUrl = `/tenant-assets/${tenant.id}/logo/logo-${suffix}.png`;
  const faviconUrl = `/tenant-assets/${tenant.id}/favicon/favicon-${suffix}.ico`;
  const seoTitle = `Tenant settings spec ${suffix}`;
  const seoDescription = `Search preview copy for tenant settings spec ${suffix}`;
  const legalNoticeText = `Hosted imprint text ${suffix}`;
  const privacyPolicyUrl = `https://legal.example.org/${tenant.id}/privacy`;
  const termsText = `Hosted terms text ${suffix}`;
  const emailSenderName = `Example Sender ${suffix}`;
  const registrationLimitCount = 4;
  const registrationLimitWindowDays = 30;
  const buyEsnCardUrl = `https://esncard.example.org/${tenant.id}`;

  await page.goto('/admin/settings');
  const generalSettings = page.locator('app-general-settings');

  await expect(
    generalSettings.getByRole('heading', { name: 'General settings' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Deferred settings' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Tenant identity' }),
  ).toBeVisible();

  await page
    .getByPlaceholder('https://section.example.org/logo.svg')
    .fill(` ${logoUrl} `);
  await page
    .getByPlaceholder('https://section.example.org/favicon.ico')
    .fill(` ${faviconUrl} `);
  await page
    .getByPlaceholder('Tenant name or public site title')
    .fill(` ${seoTitle} `);
  await page
    .getByPlaceholder('Short description for search results and previews')
    .fill(` ${seoDescription} `);
  await page.getByPlaceholder('Example Section').fill(` ${emailSenderName} `);
  await generalSettings
    .locator('mat-form-field')
    .filter({ hasText: 'Event review policy' })
    .getByRole('combobox')
    .click();
  await page
    .getByRole('option', { name: 'Organizers publish directly' })
    .click();
  await generalSettings
    .locator('mat-form-field')
    .filter({ hasText: 'Stripe account management' })
    .getByRole('combobox')
    .click();
  await page.getByRole('option', { name: 'Tenant admins manage' }).click();
  await page
    .getByPlaceholder('4')
    .fill(`${registrationLimitCount}`);
  await page
    .getByPlaceholder('30')
    .fill(`${registrationLimitWindowDays}`);
  await page
    .getByPlaceholder('Legal notice text shown at /legal/imprint')
    .fill(` ${legalNoticeText} `);
  await page
    .getByPlaceholder('https://section.example.org/privacy')
    .fill(` ${privacyPolicyUrl} `);
  await page
    .getByPlaceholder('Terms shown at /legal/terms')
    .fill(` ${termsText} `);
  const esnCardToggle = generalSettings
    .locator('mat-slide-toggle')
    .filter({ hasText: 'ESN Card discounts' })
    .getByRole('switch');
  if (!(await esnCardToggle.isChecked())) {
    await esnCardToggle.click();
  }
  await page
    .getByPlaceholder('https://esncard.org/')
    .fill(` ${buyEsnCardUrl} `);

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Tenant settings updated')).toBeVisible();

  await expect
    .poll(async () => {
      const tenantRecord = await database.query.tenants.findFirst({
        where: (tenantTable) => eq(tenantTable.id, tenant.id),
      });
      return tenantRecord?.logoUrl ?? null;
    })
    .toBe(logoUrl);
  const updatedTenant = await database.query.tenants.findFirst({
    where: (tenantTable) => eq(tenantTable.id, tenant.id),
  });
  if (!updatedTenant) {
    throw new Error('Expected tenant row after general-settings update');
  }
  expect(updatedTenant.logoUrl).toBe(logoUrl);
  expect(updatedTenant.faviconUrl).toBe(faviconUrl);
  expect(updatedTenant.seoTitle).toBe(seoTitle);
  expect(updatedTenant.seoDescription).toBe(seoDescription);
  expect(updatedTenant.emailSenderName).toBe(emailSenderName);
  expect(updatedTenant.eventReviewPolicy).toBe('organizer_self_publish');
  expect(updatedTenant.stripeAccountManagement).toBe('tenant_admin_managed');
  expect(updatedTenant.registrationLimitCount).toBe(registrationLimitCount);
  expect(updatedTenant.registrationLimitWindowDays).toBe(
    registrationLimitWindowDays,
  );
  expect(updatedTenant.legalNoticeText).toBe(legalNoticeText);
  expect(updatedTenant.privacyPolicyUrl).toBe(privacyPolicyUrl);
  expect(updatedTenant.termsText).toBe(termsText);
  expect(updatedTenant.discountProviders.esnCard).toEqual({
    config: { buyEsnCardUrl },
    status: 'enabled',
  });
});
