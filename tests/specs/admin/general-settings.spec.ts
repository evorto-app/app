import { expect } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

test('tenant admin updates relaunch general settings @admin', async ({
  database,
  page,
  seedDate,
  tenant: seededTenant,
}) => {
  const tenant = await database.query.tenants.findFirst({
    where: (tenantTable) => eq(tenantTable.id, seededTenant.id),
  });
  if (!tenant) {
    throw new Error(`Expected tenant row for ${seededTenant.id}`);
  }
  const suffix = seedDate.getTime();
  const emailSenderEmail = `operations+${suffix}@example.org`;
  const emailSenderName = `Operations ${suffix}`;
  const logoUrl = `/tenant-assets/${tenant.id}/logo/logo-${suffix}.png`;
  const faviconUrl = `/tenant-assets/${tenant.id}/favicon/favicon-${suffix}.ico`;
  const maxActiveRegistrationsPerUser = 3;
  const transferDeadlineHoursBeforeStart = 18;
  const cancellationDeadlineHoursBeforeStart = 84;
  const refundFeesOnCancellation = false;
  const seoTitle = `Tenant settings spec ${suffix}`;
  const seoDescription = `Search preview copy for tenant settings spec ${suffix}`;
  const legalNoticeText = `Hosted imprint text ${suffix}`;
  const privacyPolicyUrl = `https://legal.example.org/${tenant.id}/privacy`;
  const stripeAccountId = `acct_settings_${tenant.id}`;
  const termsText = `Hosted terms text ${suffix}`;
  const buyEsnCardUrl = `https://esncard.example.org/${tenant.id}`;

  try {
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
    await expect(
      generalSettings.getByText('Canonical root URL', { exact: true }),
    ).toBeVisible();
    await expect(
      generalSettings.getByText(tenant.canonicalRootUrl, { exact: true }),
    ).toBeVisible();
    await expect(
      generalSettings.getByRole('textbox', { name: 'Canonical root URL' }),
    ).toHaveCount(0);
    await expect(generalSettings).not.toHaveAttribute('ngh', /.*/);
    await expect(
      generalSettings.getByText('Formatting locale', { exact: true }),
    ).toBeVisible();
    await expect(
      generalSettings.getByText('de-DE', { exact: true }),
    ).toBeVisible();
    await expect(
      generalSettings.getByRole('combobox', { name: 'Locale' }),
    ).toHaveCount(0);
    const currencySelect = generalSettings.getByRole('combobox', {
      name: 'Currency',
    });
    await expect(currencySelect).toBeVisible();
    await currencySelect.click();
    await expect(page.getByRole('option', { name: 'EUR' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'CZK' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'AUD' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      generalSettings.getByRole('textbox', { name: 'Timezone' }),
    ).toHaveValue('Europe/Berlin');
    await expect(
      generalSettings.getByRole('combobox', { name: 'Timezone' }),
    ).toHaveCount(0);

    await page.getByPlaceholder('Example Section').fill(` ${emailSenderName} `);
    await page
      .getByPlaceholder('events@section.example.org')
      .fill(` ${emailSenderEmail} `);
    await page.getByPlaceholder('acct_...').fill(` ${stripeAccountId} `);
    await page
      .getByRole('spinbutton', { name: 'Active registration limit' })
      .fill(String(maxActiveRegistrationsPerUser));
    await page
      .getByRole('spinbutton', {
        name: 'Transfer deadline before event (hours)',
      })
      .fill(String(transferDeadlineHoursBeforeStart));
    await page
      .getByRole('spinbutton', {
        name: 'Cancellation deadline before event (hours)',
      })
      .fill(String(cancellationDeadlineHoursBeforeStart));
    const refundFeesToggle = generalSettings
      .locator('mat-slide-toggle')
      .filter({ hasText: 'Refund fees on cancellation' })
      .getByRole('switch');
    if (await refundFeesToggle.isChecked()) {
      await refundFeesToggle.click();
    }
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
    expect(updatedTenant.emailSenderEmail).toBe(emailSenderEmail);
    expect(updatedTenant.emailSenderName).toBe(emailSenderName);
    expect(updatedTenant.stripeAccountId).toBe(stripeAccountId);
    expect(updatedTenant.maxActiveRegistrationsPerUser).toBe(
      maxActiveRegistrationsPerUser,
    );
    expect(updatedTenant.transferDeadlineHoursBeforeStart).toBe(
      transferDeadlineHoursBeforeStart,
    );
    expect(updatedTenant.cancellationDeadlineHoursBeforeStart).toBe(
      cancellationDeadlineHoursBeforeStart,
    );
    expect(updatedTenant.refundFeesOnCancellation).toBe(
      refundFeesOnCancellation,
    );
    expect(updatedTenant.logoUrl).toBe(logoUrl);
    expect(updatedTenant.faviconUrl).toBe(faviconUrl);
    expect(updatedTenant.seoTitle).toBe(seoTitle);
    expect(updatedTenant.seoDescription).toBe(seoDescription);
    expect(updatedTenant.legalNoticeText).toBe(legalNoticeText);
    expect(updatedTenant.privacyPolicyUrl).toBe(privacyPolicyUrl);
    expect(updatedTenant.termsText).toBe(termsText);
    expect(updatedTenant.discountProviders.esnCard).toEqual({
      config: { buyEsnCardUrl },
      status: 'enabled',
    });

    await page.reload();
    await expect(page.getByPlaceholder('Example Section')).toHaveValue(
      emailSenderName,
    );
    await expect(
      page.getByPlaceholder('events@section.example.org'),
    ).toHaveValue(emailSenderEmail);
    await expect(page.getByPlaceholder('acct_...')).toHaveValue(
      stripeAccountId,
    );
    await expect(
      page.getByRole('spinbutton', { name: 'Active registration limit' }),
    ).toHaveValue(String(maxActiveRegistrationsPerUser));
    await expect(
      page.getByRole('spinbutton', {
        name: 'Transfer deadline before event (hours)',
      }),
    ).toHaveValue(String(transferDeadlineHoursBeforeStart));
    await expect(
      page.getByRole('spinbutton', {
        name: 'Cancellation deadline before event (hours)',
      }),
    ).toHaveValue(String(cancellationDeadlineHoursBeforeStart));
    await expect(refundFeesToggle).not.toBeChecked();
  } finally {
    await database
      .update(schema.tenants)
      .set({
        cancellationDeadlineHoursBeforeStart:
          tenant.cancellationDeadlineHoursBeforeStart,
        discountProviders: tenant.discountProviders,
        emailSenderEmail: tenant.emailSenderEmail,
        emailSenderName: tenant.emailSenderName,
        faviconUrl: tenant.faviconUrl,
        legalNoticeText: tenant.legalNoticeText,
        logoUrl: tenant.logoUrl,
        maxActiveRegistrationsPerUser: tenant.maxActiveRegistrationsPerUser,
        refundFeesOnCancellation: tenant.refundFeesOnCancellation,
        privacyPolicyUrl: tenant.privacyPolicyUrl,
        seoDescription: tenant.seoDescription,
        seoTitle: tenant.seoTitle,
        stripeAccountId: tenant.stripeAccountId,
        termsText: tenant.termsText,
        transferDeadlineHoursBeforeStart:
          tenant.transferDeadlineHoursBeforeStart,
      })
      .where(eq(schema.tenants.id, tenant.id));
  }
});
