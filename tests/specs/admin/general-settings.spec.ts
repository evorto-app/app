import { expect } from '@playwright/test';
import { Buffer } from 'node:buffer';

import { adminStateFile } from '../../../helpers/user-data';
import { test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('tenant admin updates general settings @admin', async ({
  database,
  page,
  seedDate,
  tenant: seededTenant,
}) => {
  const tenant = await database.query.tenants.findFirst({
    where: { id: seededTenant.id },
  });
  if (!tenant) {
    throw new Error(`Expected tenant row for ${seededTenant.id}`);
  }
  expect(tenant.domain).toBe(seededTenant.domain);
  const suffix = seedDate.getTime();
  const emailSenderEmail = `operations+${suffix}@example.org`;
  const emailSenderName = `Operations ${suffix}`;
  const maxActiveRegistrationsPerUser = 3;
  const transferDeadlineHoursBeforeStart = 18;
  const cancellationDeadlineHoursBeforeStart = 84;
  const refundFeesOnCancellation = false;
  const seoTitle = `Tenant settings spec ${suffix}`;
  const seoDescription = `Search preview copy for tenant settings spec ${suffix}`;
  const legalNoticeText = `Hosted imprint text ${suffix}`;
  const stripeAccountId = tenant.stripeAccountId;
  if (!stripeAccountId) {
    throw new Error(
      'Expected seeded tenant to have a connected Stripe account',
    );
  }
  const termsText = `Hosted terms text ${suffix}`;
  const buyEsnCardUrl = `https://esncard.example.org/${tenant.id}`;

  await test.step('Update tenant general settings', async () => {
    await page.goto('/admin/settings');
    const generalSettings = page.locator('app-general-settings');

    await expect(
      generalSettings.getByRole('heading', { name: 'General settings' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { name: 'Organization' }),
    ).toBeVisible();
    await expect(generalSettings).not.toHaveAttribute('ngh', /.*/);
    await expect(
      generalSettings.getByText('Organization name', { exact: true }),
    ).toBeVisible();
    await expect(
      generalSettings.getByText('Public domain', { exact: true }),
    ).toBeVisible();
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
    const logoUrlInput = generalSettings.getByRole('textbox', {
      name: 'Logo URL',
    });
    await generalSettings
      .getByLabel('Upload organization logo file')
      .setInputFiles({
        buffer: onePixelPng,
        mimeType: 'image/png',
        name: `tenant-logo-${suffix}.png`,
      });
    await expect(
      page.getByText('Logo uploaded. Save settings to publish it.'),
    ).toBeVisible();
    await expect(logoUrlInput).toHaveValue(
      new RegExp(`^/tenant-assets/${tenant.id}/logo/`),
    );
    const logoUrl = await logoUrlInput.inputValue();

    const faviconUrlInput = generalSettings.getByRole('textbox', {
      name: 'Favicon URL',
    });
    await generalSettings
      .getByLabel('Upload organization favicon file')
      .setInputFiles({
        buffer: onePixelPng,
        mimeType: 'image/png',
        name: `tenant-favicon-${suffix}.png`,
      });
    await expect(
      page.getByText('Favicon uploaded. Save settings to publish it.'),
    ).toBeVisible();
    await expect(faviconUrlInput).toHaveValue(
      new RegExp(`^/tenant-assets/${tenant.id}/favicon/`),
    );
    const faviconUrl = await faviconUrlInput.inputValue();
    await page
      .getByPlaceholder('Organization name or public site title')
      .fill(` ${seoTitle} `);
    await page
      .getByPlaceholder('Short description for search results and previews')
      .fill(` ${seoDescription} `);
    await page
      .getByPlaceholder('Legal notice text shown at /legal/imprint')
      .fill(` ${legalNoticeText} `);
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
    await expect(page.getByText('Organization settings updated')).toBeVisible();

    await expect
      .poll(async () => {
        const tenantRecord = await database.query.tenants.findFirst({
          where: { id: tenant.id },
        });
        return tenantRecord?.logoUrl ?? null;
      })
      .toBe(logoUrl);
    const updatedTenant = await database.query.tenants.findFirst({
      where: { id: tenant.id },
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
    expect(updatedTenant.privacyPolicyUrl).toBe(tenant.privacyPolicyUrl);
    expect(updatedTenant.termsText).toBe(termsText);
    expect(updatedTenant.discountProviders.esnCard).toEqual({
      config: { buyEsnCardUrl },
      status: 'enabled',
    });

    for (const assetUrl of [logoUrl, faviconUrl]) {
      const assetResponse = await page.request.get(assetUrl);
      expect(assetResponse.status()).toBe(200);
      expect(assetResponse.headers()['content-type']).toBe('image/png');
      expect(await assetResponse.body()).toEqual(onePixelPng);
    }

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
    await expect(logoUrlInput).toHaveValue(logoUrl);
    await expect(faviconUrlInput).toHaveValue(faviconUrl);
  });
});
