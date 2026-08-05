import { Buffer } from 'node:buffer';

import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('Manage organization settings @admin', async ({
  database,
  page,
  tenant,
}, testInfo) => {
  const documentedEmailSenderName = 'North River Events';
  const documentedEmailSenderEmail = 'events@north-river.example.org';
  const documentedRegistrationLimit = 4;
  const documentedTransferDeadlineHours = 24;
  const documentedCancellationDeadlineHours = 96;
  const documentedSeoTitle = 'North River Community Events';
  const documentedSeoDescription =
    'Organization events, trips, and member activities.';
  const documentedBuyEsnCardUrl =
    'https://north-river.example.org/membership-card';
  const documentedLogoUrl =
    'https://north-river.example.org/images/organization-logo.png';
  const documentedFaviconUrl =
    'https://north-river.example.org/images/organization-tab-icon.png';

  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Who can do this" %}
Sign in with **Change organization settings** for organization, sign-up, appearance, and legal pages. Separate **Manage payments** access is required to see whether paid sign-ups are ready and to manage currency, receipts, refunds, and discount cards.
{% /callout %}


Select **Admin Tools**. Settings are divided into five pages:

- **Organization settings** for the organization name, reply email address, default location, and time zone.
- **Sign-up rules** for how many current event sign-ups a member may hold, plus transfer and cancellation deadlines. Joining a waitlist does not count toward this limit. Evorto checks the limit when the member later tries to take an available place.
- **Appearance** for the theme, logo, tab icon, and the title and description shown in search results.
- **Legal pages** for the imprint and terms. Privacy policy changes remain on **New member setup** because members must accept a changed policy again.
- **Payments** for seeing whether paid sign-ups are ready and managing currency, refunds, receipt countries, and discount cards.

Each page has its own **Save** action. Saving one page does not change settings on another page.
`,
  });

  await page.getByRole('link', { name: 'Admin Tools' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Admin settings' }),
  ).toBeVisible();
  for (const linkName of [
    'Organization settings',
    'Sign-up rules',
    'Appearance',
    'Legal pages',
    'Payments',
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
      settings.getByText('Website address', { exact: true }),
    ).toBeVisible();
    await expect(
      settings.getByRole('combobox', { name: 'Time zone' }),
    ).toContainText('Berlin time');
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
      'Organization name, reply email, location, and time zone',
    );
    await settings
      .getByRole('button', { name: 'Save organization settings' })
      .click();
    await expect(page.getByText('Organization settings updated')).toBeVisible();
  });

  await test.step('Save sign-up rules', async () => {
    await page.getByRole('link', { name: 'Sign-up rules' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/registration$/u);
    const settings = page.locator('app-registration-settings');
    await expect(
      settings.getByText(
        'Joining a waitlist does not count toward this limit.',
      ),
    ).toBeVisible();
    await settings
      .getByRole('spinbutton', { name: 'Active sign-up limit' })
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
      'Active sign-up limit and transfer and cancellation deadlines',
    );
    await settings.getByRole('button', { name: 'Save sign-up rules' }).click();
    await expect(page.getByText('Sign-up rules updated')).toBeVisible();
  });

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

    const logoUrlInput = settings.getByRole('textbox', {
      name: 'Logo web address',
    });
    await settings.getByLabel('Upload organization logo file').setInputFiles({
      buffer: onePixelPng,
      mimeType: 'image/png',
      name: 'organization-logo.png',
    });
    await expect(logoUrlInput).toHaveValue(
      new RegExp(`/tenant-assets/${tenant.id}/logo/.+\\.png`, 'u'),
      { timeout: 15_000 },
    );
    await expect(
      page.getByText('Logo uploaded. Save appearance settings to publish it.'),
    ).toBeVisible();
    const uploadedLogoUrl = await logoUrlInput.inputValue();
    const uploadedLogoResponse = await page.request.get(uploadedLogoUrl);
    expect(uploadedLogoResponse.status()).toBe(200);
    expect(uploadedLogoResponse.headers()['content-type']).toBe('image/png');

    const faviconUrlInput = settings.getByRole('textbox', {
      name: 'Tab icon web address',
    });
    await settings
      .getByLabel('Upload organization tab icon file')
      .setInputFiles({
        buffer: onePixelPng,
        mimeType: 'image/png',
        name: 'organization-tab-icon.png',
      });
    await expect(faviconUrlInput).toHaveValue(
      new RegExp(`/tenant-assets/${tenant.id}/favicon/.+\\.png`, 'u'),
      { timeout: 15_000 },
    );
    await expect(
      page.getByText(
        'Tab icon uploaded. Save appearance settings to publish it.',
      ),
    ).toBeVisible();
    const uploadedFaviconUrl = await faviconUrlInput.inputValue();
    const uploadedFaviconResponse = await page.request.get(uploadedFaviconUrl);
    expect(uploadedFaviconResponse.status()).toBe(200);
    expect(uploadedFaviconResponse.headers()['content-type']).toBe('image/png');
    await logoUrlInput.fill(documentedLogoUrl);
    await faviconUrlInput.fill(documentedFaviconUrl);
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
      'Theme, logo, tab icon, and search preview text',
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
      settings.getByRole('link', { name: 'New member setup' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      settings,
      page,
      'Imprint and terms settings with a link to privacy setup',
    );
  });

  await test.step('Save payment settings', async () => {
    await page.getByRole('link', { name: 'Payments' }).click();
    await expect(page).toHaveURL(/\/admin\/settings\/payments$/u);
    const settings = page.locator('app-payment-provider-settings');
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
      .fill(documentedBuyEsnCardUrl);
    await takeScreenshot(
      testInfo,
      settings,
      page,
      'Payment readiness, currency, refunds, receipts, and discounts',
    );
    await settings
      .getByRole('button', { name: 'Save payment settings' })
      .click();
    await expect(page.getByText('Payment settings updated')).toBeVisible();
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
      transferDeadlineHoursBeforeStart: documentedTransferDeadlineHours,
    });

  await testInfo.attach('markdown', {
    body: `
## After saving

Each page confirms when its settings have been saved. If **Save** is unavailable, correct the highlighted fields or wait for the current save to finish. If saving fails, try again. If it continues to fail, contact Evorto support and include the settings page and exact message shown. Evorto does not replace your choice with another value.

After you save a new time zone or currency, Evorto returns you to the updated page. Currency remains unavailable after templates, events, receipts, or payments exist. If paid sign-ups are not ready, contact Evorto support before adding prices.

Tax rates remain on the separate **Tax rates** page.
`,
  });
});

test('Publish legal pages @admin', async ({
  browser,
  database,
  page,
  tenant,
}, testInfo) => {
  const legalNoticeText = `Imprint for ${tenant.name}: contact the organization board for legal notices.`;
  const privacyPolicyText = `Privacy policy for ${tenant.name}: event sign-up details are used to run this organization's events.`;
  const termsText = `Terms for ${tenant.name}: follow the event rules shown before signing up.`;

  await page.goto('/admin/settings/legal');
  const legalSettings = page.locator('app-legal-settings');
  await expect(legalSettings).not.toHaveAttribute('ngh', /.*/);

  await testInfo.attach('markdown', {
    body: `

Use **Admin Tools** → **Legal pages** for the imprint and terms. Enter approved text when Evorto should publish the page, or provide the full web address of a page on another website. When both are present, your public pages link to the page on the other website.

The privacy policy stays on **New member setup** with required member questions. Members must accept a changed privacy policy before continuing.
`,
  });

  await legalSettings
    .getByRole('textbox', { name: 'Imprint / legal notice web address' })
    .fill('');
  await legalSettings
    .getByRole('textbox', {
      name: 'Imprint / legal notice text published by Evorto',
    })
    .fill(legalNoticeText);
  await legalSettings
    .getByRole('textbox', { name: 'Terms web address' })
    .fill('');
  await legalSettings
    .getByRole('textbox', { name: 'Terms text published by Evorto' })
    .fill(termsText);
  await takeScreenshot(
    testInfo,
    legalSettings,
    page,
    'Imprint and terms ready to publish',
  );
  await legalSettings.getByRole('button', { name: 'Save legal pages' }).click();
  await expect(page.getByText('Legal settings updated')).toBeVisible();

  await legalSettings.getByRole('link', { name: 'New member setup' }).click();
  const onboardingSettings = page.locator('app-onboarding-settings');
  await onboardingSettings
    .getByRole('textbox', { name: 'Privacy policy web address' })
    .fill('');
  await onboardingSettings
    .getByRole('textbox', { name: 'Privacy policy text' })
    .fill(privacyPolicyText);
  await onboardingSettings
    .getByRole('button', { name: 'Publish changes' })
    .click();
  await expect(
    page.getByText(/members must accept the new policy before continuing/i),
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
    'Published terms page for signed-out visitors',
  );
  await publicContext.close();

  await testInfo.attach('markdown', {
    body: `
## After saving

**Legal settings updated** confirms the save. Sign out and open each footer link to confirm that visitors can read the published content.

If Evorto reports an invalid web address, copy the complete secure address from your website, or clear it and publish the text in Evorto. If an imprint or terms link is missing, return to **Legal pages**. If the privacy link is missing, return to **New member setup**. After a privacy-policy change is published, members must accept it before continuing.
`,
  });
});
