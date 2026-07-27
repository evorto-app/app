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

test('tenant admin saves each settings section independently @admin', async ({
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
  const stripeAccountId = tenant.stripeAccountId;
  if (!stripeAccountId) {
    throw new Error(
      'Expected seeded tenant to have a connected Stripe account',
    );
  }

  const suffix = seedDate.getTime();
  const emailSenderEmail = `operations+${suffix}@example.org`;
  const emailSenderName = `Operations ${suffix}`;
  const maxActiveRegistrationsPerUser = 3;
  const transferDeadlineHoursBeforeStart = 18;
  const cancellationDeadlineHoursBeforeStart = 84;
  const seoTitle = `Tenant settings spec ${suffix}`;
  const seoDescription = `Search preview copy for tenant settings spec ${suffix}`;
  const legalNoticeText = `Hosted imprint text ${suffix}`;
  const termsText = `Hosted terms text ${suffix}`;
  const buyEsnCardUrl = `https://esncard.example.org/${tenant.id}`;

  await test.step('Save organization settings', async () => {
    await page.goto('/admin/settings');
    const settings = page.locator('app-organization-settings');
    await expect(
      settings.getByRole('heading', { name: 'Organization settings' }),
    ).toBeVisible();
    await expect(settings).not.toHaveAttribute('ngh', /.*/);
    await expect(
      settings.getByText('Organization name', { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByText('Public domain', { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByRole('textbox', { name: 'Timezone' }),
    ).toHaveValue('Europe/Berlin');

    await settings
      .getByPlaceholder('Example Section')
      .fill(` ${emailSenderName} `);
    await settings
      .getByPlaceholder('events@section.example.org')
      .fill(` ${emailSenderEmail} `);
    await settings
      .getByRole('button', { name: 'Save organization settings' })
      .click();
    await expect(page.getByText('Organization settings updated')).toBeVisible();

    await expect
      .poll(async () =>
        database.query.tenants.findFirst({
          columns: { emailSenderEmail: true, emailSenderName: true },
          where: { id: tenant.id },
        }),
      )
      .toMatchObject({
        emailSenderEmail,
        emailSenderName,
      });
  });

  await test.step('Save registration policies', async () => {
    await page.goto('/admin/settings/registration');
    const settings = page.locator('app-registration-settings');
    await expect(
      settings.getByRole('heading', { name: 'Registration policies' }),
    ).toBeVisible();
    await expect(
      settings.getByText('Waitlist entries do not consume this limit.'),
    ).toBeVisible();
    await settings
      .getByRole('spinbutton', { name: 'Active registration limit' })
      .fill(String(maxActiveRegistrationsPerUser));
    await settings
      .getByRole('spinbutton', {
        name: 'Transfer deadline before event (hours)',
      })
      .fill(String(transferDeadlineHoursBeforeStart));
    await settings
      .getByRole('spinbutton', {
        name: 'Cancellation deadline before event (hours)',
      })
      .fill(String(cancellationDeadlineHoursBeforeStart));
    await settings
      .getByRole('button', { name: 'Save registration policies' })
      .click();
    await expect(page.getByText('Registration policies updated')).toBeVisible();

    await expect
      .poll(async () =>
        database.query.tenants.findFirst({
          columns: {
            cancellationDeadlineHoursBeforeStart: true,
            maxActiveRegistrationsPerUser: true,
            transferDeadlineHoursBeforeStart: true,
          },
          where: { id: tenant.id },
        }),
      )
      .toMatchObject({
        cancellationDeadlineHoursBeforeStart,
        maxActiveRegistrationsPerUser,
        transferDeadlineHoursBeforeStart,
      });
  });

  let logoUrl = '';
  let faviconUrl = '';
  await test.step('Save appearance settings', async () => {
    await page.goto('/admin/settings/appearance');
    const settings = page.locator('app-appearance-settings');
    await expect(
      settings.getByRole('heading', { name: 'Appearance' }),
    ).toBeVisible();

    const logoUrlInput = settings.getByRole('textbox', { name: 'Logo URL' });
    await settings.getByLabel('Upload organization logo file').setInputFiles({
      buffer: onePixelPng,
      mimeType: 'image/png',
      name: `tenant-logo-${suffix}.png`,
    });
    await expect(
      page.getByText('Logo uploaded. Save appearance settings to publish it.'),
    ).toBeVisible();
    await expect(logoUrlInput).toHaveValue(
      new RegExp(`^/tenant-assets/${tenant.id}/logo/`),
    );
    logoUrl = await logoUrlInput.inputValue();

    const faviconUrlInput = settings.getByRole('textbox', {
      name: 'Favicon URL',
    });
    await settings
      .getByLabel('Upload organization favicon file')
      .setInputFiles({
        buffer: onePixelPng,
        mimeType: 'image/png',
        name: `tenant-favicon-${suffix}.png`,
      });
    await expect(
      page.getByText(
        'Favicon uploaded. Save appearance settings to publish it.',
      ),
    ).toBeVisible();
    await expect(faviconUrlInput).toHaveValue(
      new RegExp(`^/tenant-assets/${tenant.id}/favicon/`),
    );
    faviconUrl = await faviconUrlInput.inputValue();

    await settings
      .getByPlaceholder('Organization name or public site title')
      .fill(` ${seoTitle} `);
    await settings
      .getByPlaceholder('Short description for search results and previews')
      .fill(` ${seoDescription} `);
    await settings
      .getByRole('button', { name: 'Save appearance settings' })
      .click();
    await expect(page.getByText('Appearance settings updated')).toBeVisible();

    await expect
      .poll(async () =>
        database.query.tenants.findFirst({
          columns: {
            faviconUrl: true,
            logoUrl: true,
            seoDescription: true,
            seoTitle: true,
          },
          where: { id: tenant.id },
        }),
      )
      .toMatchObject({
        faviconUrl,
        logoUrl,
        seoDescription,
        seoTitle,
      });
  });

  await test.step('Save legal pages', async () => {
    await page.goto('/admin/settings/legal');
    const settings = page.locator('app-legal-settings');
    await expect(
      settings.getByRole('heading', { name: 'Legal pages' }),
    ).toBeVisible();
    await settings
      .getByPlaceholder('Legal notice text shown at /legal/imprint')
      .fill(` ${legalNoticeText} `);
    await settings
      .getByPlaceholder('Terms shown at /legal/terms')
      .fill(` ${termsText} `);
    await settings.getByRole('button', { name: 'Save legal pages' }).click();
    await expect(page.getByText('Legal settings updated')).toBeVisible();

    await expect
      .poll(async () =>
        database.query.tenants.findFirst({
          columns: {
            legalNoticeText: true,
            termsText: true,
          },
          where: { id: tenant.id },
        }),
      )
      .toMatchObject({
        legalNoticeText,
        termsText,
      });
  });

  await test.step('Save payments and providers', async () => {
    await page.goto('/admin/settings/payments');
    const settings = page.locator('app-payment-provider-settings');
    await expect(
      settings.getByRole('heading', { name: 'Payments and providers' }),
    ).toBeVisible();

    const currencySelect = settings.getByRole('combobox', {
      name: 'Currency',
    });
    await currencySelect.click();
    await expect(page.getByRole('option', { name: 'EUR' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'CZK' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'AUD' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings.getByPlaceholder('acct_...')).toHaveValue(
      stripeAccountId,
    );

    const refundFeesToggle = settings
      .locator('mat-slide-toggle')
      .filter({ hasText: 'Refund fees on cancellation' })
      .getByRole('switch');
    if (await refundFeesToggle.isChecked()) {
      await refundFeesToggle.click();
    }
    const esnCardToggle = settings
      .locator('mat-slide-toggle')
      .filter({ hasText: 'ESN Card discounts' })
      .getByRole('switch');
    if (!(await esnCardToggle.isChecked())) {
      await esnCardToggle.click();
    }
    await settings
      .getByPlaceholder('https://esncard.org/')
      .fill(` ${buyEsnCardUrl} `);
    await settings
      .getByRole('button', { name: 'Save payment and provider settings' })
      .click();
    await expect(
      page.getByText('Payment and provider settings updated'),
    ).toBeVisible();

    await expect
      .poll(async () =>
        database.query.tenants.findFirst({
          columns: {
            discountProviders: true,
            refundFeesOnCancellation: true,
            stripeAccountId: true,
          },
          where: { id: tenant.id },
        }),
      )
      .toMatchObject({
        discountProviders: {
          esnCard: {
            config: { buyEsnCardUrl },
            status: 'enabled',
          },
        },
        refundFeesOnCancellation: false,
        stripeAccountId,
      });
  });

  for (const assetUrl of [logoUrl, faviconUrl]) {
    const assetResponse = await page.request.get(assetUrl);
    expect(assetResponse.status()).toBe(200);
    expect(assetResponse.headers()['content-type']).toBe('image/png');
    expect(await assetResponse.body()).toEqual(onePixelPng);
  }
});
