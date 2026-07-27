import { Buffer } from 'node:buffer';

import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('Manage focused organization settings @admin', async ({
  database,
  page,
  tenant,
}, testInfo) => {
  const tenantRecord = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });
  if (!tenantRecord) {
    throw new Error('Expected generated focused-settings docs tenant');
  }
  const documentedStripeAccountId = tenantRecord.stripeAccountId;
  if (!documentedStripeAccountId) {
    throw new Error(
      'Expected generated focused-settings docs tenant to have a connected Stripe account',
    );
  }

  const documentedEmailSenderName = 'Documentation Operations';
  const documentedEmailSenderEmail = `operations+${tenant.id}@example.org`;
  const documentedRegistrationLimit = 4;
  const documentedTransferDeadlineHours = 24;
  const documentedCancellationDeadlineHours = 96;
  const documentedSeoTitle = `Documentation organization ${tenant.id}`;
  const documentedSeoDescription =
    'Organization events, trips, and member activities.';
  const documentedBuyEsnCardUrl = `https://esncard.example.org/${tenant.id}`;

  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Before you begin" %}
Sign in with **Change organization settings** for organization, registration, appearance, and legal pages. The separate **Manage payments and providers** permission is required for Stripe, currency, receipt, refund, and discount-provider settings.
{% /callout %}

# Manage organization settings

Select **Admin Tools**. Evorto keeps the familiar two-column administration layout, but settings are divided into five focused pages:

- **Organization settings** for the read-only organization identity, reply-to identity, default location, and timezone.
- **Registration policies** for active-registration limits and transfer and cancellation deadlines. Waitlist entries do not consume the active-registration limit; the limit is checked when a place becomes a real registration.
- **Appearance** for the theme, brand assets, and search preview.
- **Legal pages** for the imprint and terms. Privacy policy changes remain on **Member onboarding** because they create a new acceptance version.
- **Payments and providers** for Stripe, currency, refunds, receipt countries, and discount-card providers.

Each page has its own Save action and sends a full payload only for that section. Saving one page does not resubmit unrelated settings.
`,
  });

  await page.getByRole('link', { name: 'Admin Tools' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Admin settings' }),
  ).toBeVisible();
  for (const linkName of [
    'Organization settings',
    'Registration policies',
    'Appearance',
    'Legal pages',
    'Payments and providers',
  ]) {
    await expect(page.getByRole('link', { name: linkName })).toBeVisible();
  }

  await test.step('Save organization settings', async () => {
    await page.getByRole('link', { name: 'Organization settings' }).click();
    await expect(page).toHaveURL(/\/admin\/settings$/u);
    const settings = page.locator('app-organization-settings');
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
      .fill(` ${documentedEmailSenderName} `);
    await settings
      .getByPlaceholder('events@section.example.org')
      .fill(` ${documentedEmailSenderEmail} `);
    await takeScreenshot(
      testInfo,
      settings,
      page,
      'Focused organization settings',
    );
    await settings
      .getByRole('button', { name: 'Save organization settings' })
      .click();
    await expect(page.getByText('Organization settings updated')).toBeVisible();
  });

  await test.step('Save registration policies', async () => {
    await page.getByRole('link', { name: 'Registration policies' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/registration$/u);
    const settings = page.locator('app-registration-settings');
    await expect(
      settings.getByText('Waitlist entries do not consume this limit.'),
    ).toBeVisible();
    await settings
      .getByRole('spinbutton', { name: 'Active registration limit' })
      .fill(String(documentedRegistrationLimit));
    await settings
      .getByRole('spinbutton', {
        name: 'Transfer deadline before event (hours)',
      })
      .fill(String(documentedTransferDeadlineHours));
    await settings
      .getByRole('spinbutton', {
        name: 'Cancellation deadline before event (hours)',
      })
      .fill(String(documentedCancellationDeadlineHours));
    await takeScreenshot(
      testInfo,
      settings,
      page,
      'Focused registration policies',
    );
    await settings
      .getByRole('button', { name: 'Save registration policies' })
      .click();
    await expect(page.getByText('Registration policies updated')).toBeVisible();
  });

  let documentedLogoUrl = '';
  let documentedFaviconUrl = '';
  await test.step('Upload and save appearance', async () => {
    await page.getByRole('link', { name: 'Appearance' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/appearance$/u);
    const settings = page.locator('app-appearance-settings');
    const themeSelect = settings.getByRole('combobox', { name: 'Site theme' });
    await themeSelect.click();
    await expect(
      page.getByRole('option', { name: 'Default theme' }),
    ).toBeVisible();
    await expect(
      page.getByRole('option', { name: 'Classic Evorto theme' }),
    ).toBeVisible();
    await expect(page.getByRole('option', { name: 'ESN theme' })).toBeVisible();
    await page.keyboard.press('Escape');

    const logoUrlInput = settings.getByRole('textbox', { name: 'Logo URL' });
    await settings.getByLabel('Upload organization logo file').setInputFiles({
      buffer: onePixelPng,
      mimeType: 'image/png',
      name: `documentation-logo-${tenant.id}.png`,
    });
    await expect(
      page.getByText('Logo uploaded. Save appearance settings to publish it.'),
    ).toBeVisible();
    documentedLogoUrl = await logoUrlInput.inputValue();

    const faviconUrlInput = settings.getByRole('textbox', {
      name: 'Favicon URL',
    });
    await settings
      .getByLabel('Upload organization favicon file')
      .setInputFiles({
        buffer: onePixelPng,
        mimeType: 'image/png',
        name: `documentation-favicon-${tenant.id}.png`,
      });
    await expect(
      page.getByText(
        'Favicon uploaded. Save appearance settings to publish it.',
      ),
    ).toBeVisible();
    documentedFaviconUrl = await faviconUrlInput.inputValue();
    await settings
      .getByPlaceholder('Organization name or public site title')
      .fill(documentedSeoTitle);
    await settings
      .getByPlaceholder('Short description for search results and previews')
      .fill(documentedSeoDescription);
    await takeScreenshot(
      testInfo,
      settings,
      page,
      'Focused appearance settings',
    );
    await settings
      .getByRole('button', { name: 'Save appearance settings' })
      .click();
    await expect(page.getByText('Appearance settings updated')).toBeVisible();
  });

  await test.step('Review legal page ownership', async () => {
    await page.getByRole('link', { name: 'Legal pages' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/legal$/u);
    const settings = page.locator('app-legal-settings');
    await expect(
      settings.getByRole('link', { name: 'Member onboarding' }),
    ).toBeVisible();
    await takeScreenshot(testInfo, settings, page, 'Focused legal pages');
  });

  await test.step('Save payments and providers', async () => {
    await page.getByRole('link', { name: 'Payments and providers' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/payments$/u);
    const settings = page.locator('app-payment-provider-settings');
    await expect(settings.getByPlaceholder('acct_...')).toHaveValue(
      documentedStripeAccountId,
    );
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
      .filter({ hasText: 'ESN Card discounts' })
      .getByRole('switch');
    if (!(await esnCardToggle.isChecked())) {
      await esnCardToggle.click();
    }
    await settings
      .getByPlaceholder('https://esncard.org/')
      .fill(documentedBuyEsnCardUrl);
    await takeScreenshot(
      testInfo,
      settings,
      page,
      'Restricted payments and providers settings',
    );
    await settings
      .getByRole('button', { name: 'Save payment and provider settings' })
      .click();
    await expect(
      page.getByText('Payment and provider settings updated'),
    ).toBeVisible();
  });

  await expect
    .poll(async () => {
      const persisted = await database.query.tenants.findFirst({
        where: { id: tenant.id },
      });
      return persisted
        ? {
            cancellationDeadlineHoursBeforeStart:
              persisted.cancellationDeadlineHoursBeforeStart,
            discountProviders: persisted.discountProviders,
            emailSenderEmail: persisted.emailSenderEmail,
            emailSenderName: persisted.emailSenderName,
            faviconUrl: persisted.faviconUrl,
            logoUrl: persisted.logoUrl,
            maxActiveRegistrationsPerUser:
              persisted.maxActiveRegistrationsPerUser,
            refundFeesOnCancellation: persisted.refundFeesOnCancellation,
            seoDescription: persisted.seoDescription,
            seoTitle: persisted.seoTitle,
            stripeAccountId: persisted.stripeAccountId,
            transferDeadlineHoursBeforeStart:
              persisted.transferDeadlineHoursBeforeStart,
          }
        : null;
    })
    .toEqual({
      cancellationDeadlineHoursBeforeStart: documentedCancellationDeadlineHours,
      discountProviders: {
        esnCard: {
          config: { buyEsnCardUrl: documentedBuyEsnCardUrl },
          status: 'enabled',
        },
      },
      emailSenderEmail: documentedEmailSenderEmail,
      emailSenderName: documentedEmailSenderName,
      faviconUrl: documentedFaviconUrl,
      logoUrl: documentedLogoUrl,
      maxActiveRegistrationsPerUser: documentedRegistrationLimit,
      refundFeesOnCancellation: false,
      seoDescription: documentedSeoDescription,
      seoTitle: documentedSeoTitle,
      stripeAccountId: documentedStripeAccountId,
      transferDeadlineHoursBeforeStart: documentedTransferDeadlineHours,
    });

  for (const assetUrl of [documentedLogoUrl, documentedFaviconUrl]) {
    const assetResponse = await page.request.get(assetUrl);
    expect(assetResponse.status()).toBe(200);
    expect(assetResponse.headers()['content-type']).toBe('image/png');
  }

  await testInfo.attach('markdown', {
    body: `
## Completion and recovery

Each page confirms its own successful save. Invalid forms and in-flight requests keep that page's Save action unavailable. Correct the visible value or typed failure and try again; Evorto does not silently fall back to another value.

Changing the organization timezone reloads the application after the save. Changing currency also reloads after the save and remains blocked after templates, events, receipts, or transactions exist. Changing or disconnecting Stripe remains blocked while payment obligations or incompatible paid configuration exist. Confirm provider-account changes in Stripe before saving.

Tax rates remain on the separate **Tax Rates** page.
`,
  });
});

test('Publish hosted legal pages and verify the signed-out footer @admin', async ({
  browser,
  database,
  page,
  tenant,
}, testInfo) => {
  const legalNoticeText = `Imprint for ${tenant.name}: contact the organization board for legal notices.`;
  const privacyPolicyText = `Privacy policy for ${tenant.name}: event registration data is used to operate this organization's events.`;
  const termsText = `Terms for ${tenant.name}: follow the event rules shown before registration.`;

  await page.goto('/admin/settings/legal');
  const legalSettings = page.locator('app-legal-settings');
  await expect(legalSettings).not.toHaveAttribute('ngh', /.*/);

  await testInfo.attach('markdown', {
    body: `
# Publish hosted legal pages

Use **Admin Tools** -> **Legal pages** for the imprint and terms. Enter only approved hosted text when Evorto should publish the page, or enter an external absolute HTTP(S) URL when another website owns it. When both are present, the public footer uses the external URL.

The privacy policy stays on **Member onboarding** with required member questions. Publishing a privacy-policy change creates a new version that members must accept before continuing.
`,
  });

  await legalSettings
    .getByRole('textbox', { name: 'Imprint / legal notice URL' })
    .fill('');
  await legalSettings
    .getByRole('textbox', { name: 'Hosted imprint / legal notice text' })
    .fill(legalNoticeText);
  await legalSettings.getByRole('textbox', { name: 'Terms URL' }).fill('');
  await legalSettings
    .getByRole('textbox', { name: 'Hosted terms text' })
    .fill(termsText);
  await takeScreenshot(
    testInfo,
    legalSettings,
    page,
    'Hosted imprint and terms ready to publish',
  );
  await legalSettings.getByRole('button', { name: 'Save legal pages' }).click();
  await expect(page.getByText('Legal settings updated')).toBeVisible();

  await legalSettings.getByRole('link', { name: 'Member onboarding' }).click();
  const onboardingSettings = page.locator('app-onboarding-settings');
  await onboardingSettings
    .getByRole('textbox', { name: 'Privacy policy URL' })
    .fill('');
  await onboardingSettings
    .getByRole('textbox', { name: 'Privacy policy text' })
    .fill(privacyPolicyText);
  await onboardingSettings
    .getByRole('button', { name: 'Publish settings' })
    .click();
  await expect(
    page.getByText(/members must accept it before continuing/i),
  ).toBeVisible();

  await expect
    .poll(async () => {
      const persistedTenant = await database.query.tenants.findFirst({
        columns: {
          legalNoticeText: true,
          legalNoticeUrl: true,
          termsText: true,
          termsUrl: true,
        },
        where: { id: tenant.id },
        with: {
          privacyPolicyVersions: {
            columns: {
              privacyPolicyText: true,
              privacyPolicyUrl: true,
            },
            limit: 1,
            orderBy: { version: 'desc' },
          },
        },
      });
      const currentPrivacyPolicy = persistedTenant?.privacyPolicyVersions[0];
      return persistedTenant && currentPrivacyPolicy
        ? {
            legalNoticeText: persistedTenant.legalNoticeText,
            legalNoticeUrl: persistedTenant.legalNoticeUrl,
            privacyPolicyText: currentPrivacyPolicy.privacyPolicyText,
            privacyPolicyUrl: currentPrivacyPolicy.privacyPolicyUrl,
            termsText: persistedTenant.termsText,
            termsUrl: persistedTenant.termsUrl,
          }
        : null;
    })
    .toEqual({
      legalNoticeText,
      legalNoticeUrl: null,
      privacyPolicyText,
      privacyPolicyUrl: null,
      termsText,
      termsUrl: null,
    });

  const tenantUrl = new URL(page.url());
  const publicContext = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  await publicContext.addCookies([
    {
      domain: tenantUrl.hostname,
      expires: -1,
      name: 'evorto-tenant',
      path: '/',
      value: tenant.domain,
    },
  ]);
  const publicPage = await publicContext.newPage();
  await publicPage.goto(`${tenantUrl.origin}/events`);
  const publicFooter = publicPage.getByRole('contentinfo');

  await publicFooter
    .getByRole('link', { name: 'Imprint', exact: true })
    .click();
  await expect(
    publicPage.getByRole('heading', { level: 1, name: 'Imprint' }),
  ).toBeVisible();
  await expect(
    publicPage.getByText(legalNoticeText, { exact: true }),
  ).toBeVisible();

  await publicPage.getByRole('link', { name: 'Back to events' }).click();
  await publicFooter
    .getByRole('link', { name: 'Privacy', exact: true })
    .click();
  await expect(
    publicPage.getByRole('heading', { level: 1, name: 'Privacy policy' }),
  ).toBeVisible();
  await expect(
    publicPage.getByText(privacyPolicyText, { exact: true }),
  ).toBeVisible();

  await publicPage.getByRole('link', { name: 'Back to events' }).click();
  await publicFooter.getByRole('link', { name: 'Terms', exact: true }).click();
  await expect(publicPage.getByText(termsText, { exact: true })).toBeVisible();
  await takeScreenshot(
    testInfo,
    publicPage.locator('main'),
    publicPage,
    'Signed-out hosted terms page',
  );
  await publicContext.close();

  await testInfo.attach('markdown', {
    body: `
## Completion and recovery

**Legal settings updated** confirms the imprint and terms save. A signed-out visitor must then be able to follow each footer link and read the published content.

If Evorto reports an invalid URL, correct it to an absolute HTTP(S) address or clear it and use hosted text. If an imprint or terms link is missing, return to **Legal pages**. If the privacy link is missing, return to **Member onboarding**. Publishing a privacy-policy change deliberately blocks protected work until the current user accepts the new version.
`,
  });
});
