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
  const paymentAccountId = tenant.stripeAccountId;
  if (!paymentAccountId) {
    throw new Error('Expected seeded tenant to have payments ready');
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
      settings.getByText('Website address', { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByRole('combobox', { name: 'Time zone' }),
    ).toHaveText('Berlin time');

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

  await test.step('Save sign-up rules', async () => {
    await page.goto('/admin/settings/registration');
    const settings = page.locator('app-registration-settings');
    await expect(
      settings.getByRole('heading', { name: 'Sign-up rules' }),
    ).toBeVisible();
    await expect(
      settings.getByText(
        'Joining a waitlist does not count toward this limit.',
      ),
    ).toBeVisible();
    await settings
      .getByRole('spinbutton', { name: 'Active sign-up limit' })
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
    await settings.getByRole('button', { name: 'Save sign-up rules' }).click();
    await expect(page.getByText('Sign-up rules updated')).toBeVisible();

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

    const logoUrlInput = settings.getByRole('textbox', {
      name: 'Logo web address',
    });
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
      name: 'Tab icon web address',
    });
    await settings
      .getByLabel('Upload organization tab icon file')
      .setInputFiles({
        buffer: onePixelPng,
        mimeType: 'image/png',
        name: `tenant-favicon-${suffix}.png`,
      });
    await expect(
      page.getByText(
        'Tab icon uploaded. Save appearance settings to publish it.',
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
      .getByRole('textbox', {
        name: 'Imprint / legal notice text published by Evorto',
      })
      .fill(` ${legalNoticeText} `);
    await settings
      .getByRole('textbox', { name: 'Terms text published by Evorto' })
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

  await test.step('Save payment settings', async () => {
    await page.goto('/admin/settings/payments');
    const settings = page.locator('app-payment-provider-settings');
    await expect(
      settings.getByRole('heading', { name: 'Payments' }),
    ).toBeVisible();
    await expect(settings.getByText('Paid sign-ups are ready.')).toBeVisible();

    const currencySelect = settings.getByRole('combobox', {
      name: 'Currency',
    });
    await currencySelect.click();
    await expect(page.getByRole('option', { name: 'EUR' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'CZK' })).toBeVisible();
    await expect(page.getByRole('option', { name: 'AUD' })).toBeVisible();
    await page.keyboard.press('Escape');
    const refundFeesToggle = settings
      .locator('mat-slide-toggle')
      .filter({ hasText: 'Refund fees on cancellation' })
      .getByRole('switch');
    if (await refundFeesToggle.isChecked()) {
      await refundFeesToggle.click();
    }
    const esnCardToggle = settings
      .locator('mat-slide-toggle')
      .filter({ hasText: 'ESNcard discounts' })
      .getByRole('switch');
    if (!(await esnCardToggle.isChecked())) {
      await esnCardToggle.click();
    }
    await settings
      .getByPlaceholder('https://esncard.org/')
      .fill(` ${buyEsnCardUrl} `);
    await settings
      .getByRole('button', { name: 'Save payment settings' })
      .click();
    await expect(page.getByText('Payment settings updated')).toBeVisible();

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
        stripeAccountId: paymentAccountId,
      });
  });

  for (const assetUrl of [logoUrl, faviconUrl]) {
    const assetResponse = await page.request.get(assetUrl);
    expect(assetResponse.status()).toBe(200);
    expect(assetResponse.headers()['content-type']).toBe('image/png');
    expect(await assetResponse.body()).toEqual(onePixelPng);
  }
});
