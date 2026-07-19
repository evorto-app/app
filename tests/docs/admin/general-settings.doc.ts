import { Buffer } from 'node:buffer';

import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

const onePixelPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);

test('Manage organization general settings @admin', async ({
  database,
  page,
  tenant,
}, testInfo) => {
  const tenantRecord = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });
  if (!tenantRecord) {
    throw new Error('Expected generated general-settings docs tenant');
  }
  expect(tenantRecord.domain).toBe(tenant.domain);
  const documentedEmailSenderName = 'Documentation Operations';
  const documentedEmailSenderEmail = `operations+${tenant.id}@example.org`;
  const documentedStripeAccountId = tenantRecord.stripeAccountId;
  if (!documentedStripeAccountId) {
    throw new Error(
      'Expected generated general-settings docs tenant to have a connected Stripe account',
    );
  }
  const documentedRegistrationLimit = 4;
  const documentedTransferDeadlineHours = 24;
  const documentedCancellationDeadlineHours = 96;
  const documentedRefundFeesOnCancellation = false;

  await test.step('Document tenant general settings', async () => {
    await page.goto('.');

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Before you begin" %}
Sign in as an organization administrator with access to change organization settings.
{% /callout %}

# Organization General Settings

Use **Admin Tools** -> **General settings** to review and change the organization currently shown in Evorto. These changes do not affect another organization.
`,
    });

    await page.getByRole('link', { name: 'Admin Tools' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Admin settings' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'General settings' }).click();
    await expect(page).toHaveURL(/\/admin\/settings$/);
    const generalSettings = page.locator('app-general-settings');
    await expect(generalSettings).toBeVisible();
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
    await takeScreenshot(
      testInfo,
      generalSettings,
      page,
      'Organization general settings',
    );

    await testInfo.attach('markdown', {
      body: `
## Upload organization branding

The **Brand assets** section supports uploaded files and externally hosted HTTP(S) URLs.

To upload a logo:

1. Select **Upload logo** and choose a PNG, JPEG, WebP, or GIF file no larger than 5 MB.
2. Wait for **Logo uploaded. Save settings to publish it.** The new logo appears in **Logo URL**.
3. Review the generated URL, then select **Save** with the rest of the settings. Uploading the file alone does not publish it as the organization logo.

Use **Upload favicon** the same way. Favicons additionally accept ICO files. If an upload is rejected, choose a supported, non-empty file within the size limit and try again. You can instead paste an externally hosted HTTP(S) URL into either URL field. Use uploaded assets that belong to this organization.
`,
    });

    const logoUrlInput = generalSettings.getByRole('textbox', {
      name: 'Logo URL',
    });
    await generalSettings
      .getByLabel('Upload organization logo file')
      .setInputFiles({
        buffer: onePixelPng,
        mimeType: 'image/png',
        name: `documentation-logo-${tenant.id}.png`,
      });
    await expect(
      page.getByText('Logo uploaded. Save settings to publish it.'),
    ).toBeVisible();
    await expect(logoUrlInput).toHaveValue(
      new RegExp(`^/tenant-assets/${tenant.id}/logo/`),
    );
    const documentedLogoUrl = await logoUrlInput.inputValue();

    const faviconUrlInput = generalSettings.getByRole('textbox', {
      name: 'Favicon URL',
    });
    await generalSettings
      .getByLabel('Upload organization favicon file')
      .setInputFiles({
        buffer: onePixelPng,
        mimeType: 'image/png',
        name: `documentation-favicon-${tenant.id}.png`,
      });
    await expect(
      page.getByText('Favicon uploaded. Save settings to publish it.'),
    ).toBeVisible();
    await expect(faviconUrlInput).toHaveValue(
      new RegExp(`^/tenant-assets/${tenant.id}/favicon/`),
    );
    const documentedFaviconUrl = await faviconUrlInput.inputValue();
    await takeScreenshot(
      testInfo,
      generalSettings,
      page,
      'Uploaded organization brand assets awaiting save',
    );

    await testInfo.attach('markdown', {
      body: `
## Understand the operations fields before saving

In **Operations settings**:

1. **Email reply-to name** and **Email reply-to email** control where replies to organization emails go. Evorto keeps the actual From address on the ESN.WORLD notification domain.
2. **Stripe account ID** identifies the Stripe account used for organization payments. Confirm the account in Stripe before changing it. Without a connected account, every event registration option and add-on must be free. Remove an account only after all paid event and add-on configuration has been converted to free.
3. **Active registration limit** caps how many active registrations one person may have across this organization. Enter **0** for no organization-wide limit.
4. **Transfer deadline before event (hours)** says how long before an event starts participants stop being able to transfer a registration. Enter **0** to allow transfers until the event starts.
5. **Cancellation deadline before event (hours)** says how long before an event starts participant cancellations close. The default **120** is five days.
6. **Refund fees on cancellation** controls whether eligible cancellation refunds include refundable payment fees.

The walkthrough below updates these values and the uploaded brand assets while preserving the connected Stripe account. It saves the form, reloads the page, and confirms that the same values remain.
`,
    });

    await page
      .getByPlaceholder('Example Section')
      .fill(` ${documentedEmailSenderName} `);
    await page
      .getByPlaceholder('events@section.example.org')
      .fill(` ${documentedEmailSenderEmail} `);
    await page
      .getByPlaceholder('acct_...')
      .fill(` ${documentedStripeAccountId} `);
    await page
      .getByRole('spinbutton', { name: 'Active registration limit' })
      .fill(String(documentedRegistrationLimit));
    await page
      .getByRole('spinbutton', {
        name: 'Transfer deadline before event (hours)',
      })
      .fill(String(documentedTransferDeadlineHours));
    await page
      .getByRole('spinbutton', {
        name: 'Cancellation deadline before event (hours)',
      })
      .fill(String(documentedCancellationDeadlineHours));
    const refundFeesToggle = generalSettings
      .locator('mat-slide-toggle')
      .filter({ hasText: 'Refund fees on cancellation' })
      .getByRole('switch');
    if (await refundFeesToggle.isChecked()) {
      await refundFeesToggle.click();
    }
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Organization settings updated')).toBeVisible();

    await expect
      .poll(async () => {
        const persistedTenant = await database.query.tenants.findFirst({
          where: { id: tenant.id },
        });
        return persistedTenant
          ? {
              cancellationDeadlineHoursBeforeStart:
                persistedTenant.cancellationDeadlineHoursBeforeStart,
              emailSenderEmail: persistedTenant.emailSenderEmail,
              emailSenderName: persistedTenant.emailSenderName,
              faviconUrl: persistedTenant.faviconUrl,
              logoUrl: persistedTenant.logoUrl,
              maxActiveRegistrationsPerUser:
                persistedTenant.maxActiveRegistrationsPerUser,
              refundFeesOnCancellation:
                persistedTenant.refundFeesOnCancellation,
              stripeAccountId: persistedTenant.stripeAccountId,
              transferDeadlineHoursBeforeStart:
                persistedTenant.transferDeadlineHoursBeforeStart,
            }
          : null;
      })
      .toEqual({
        cancellationDeadlineHoursBeforeStart:
          documentedCancellationDeadlineHours,
        emailSenderEmail: documentedEmailSenderEmail,
        emailSenderName: documentedEmailSenderName,
        faviconUrl: documentedFaviconUrl,
        logoUrl: documentedLogoUrl,
        maxActiveRegistrationsPerUser: documentedRegistrationLimit,
        refundFeesOnCancellation: documentedRefundFeesOnCancellation,
        stripeAccountId: documentedStripeAccountId,
        transferDeadlineHoursBeforeStart: documentedTransferDeadlineHours,
      });

    await page.reload();
    await expect(page.getByPlaceholder('Example Section')).toHaveValue(
      documentedEmailSenderName,
    );
    await expect(
      page.getByPlaceholder('events@section.example.org'),
    ).toHaveValue(documentedEmailSenderEmail);
    await expect(page.getByPlaceholder('acct_...')).toHaveValue(
      documentedStripeAccountId,
    );
    await expect(
      page.getByRole('spinbutton', { name: 'Active registration limit' }),
    ).toHaveValue(String(documentedRegistrationLimit));
    await expect(
      page.getByRole('spinbutton', {
        name: 'Transfer deadline before event (hours)',
      }),
    ).toHaveValue(String(documentedTransferDeadlineHours));
    await expect(
      page.getByRole('spinbutton', {
        name: 'Cancellation deadline before event (hours)',
      }),
    ).toHaveValue(String(documentedCancellationDeadlineHours));
    await expect(refundFeesToggle).not.toBeChecked();
    await expect(logoUrlInput).toHaveValue(documentedLogoUrl);
    await expect(faviconUrlInput).toHaveValue(documentedFaviconUrl);
    for (const assetUrl of [documentedLogoUrl, documentedFaviconUrl]) {
      const assetResponse = await page.request.get(assetUrl);
      expect(assetResponse.status()).toBe(200);
      expect(assetResponse.headers()['content-type']).toBe('image/png');
    }
    await takeScreenshot(
      testInfo,
      generalSettings,
      page,
      'Saved organization operations settings',
    );

    await testInfo.attach('markdown', {
      body: `
## Completion and recovery

The **Organization settings updated** message confirms that the changes were saved. Reload the page when you want to confirm the saved reply-to identity, Stripe account ID, registration limit, transfer deadline, cancellation deadline, and fee-refund choice.

The Save action remains unavailable while the form is invalid or another save is running. If Evorto cannot save a change, it explains what needs attention; correct the value and try again. Evorto prevents currency and timezone changes after event or payment data exists.

## Current settings surface

The current general settings page supports:

- A read-only **Organization** summary with its name and public domain.
- **Operations settings** for email reply-to name/email, Stripe account id, the organization-wide active registration limit, default registration transfer/cancellation deadlines, and cancellation fee-refund behavior. Users with event-review access can review submitted events.
- **Default Location** for event location search bias.
- **Site theme** for the organization's theme.
- A **Currency** select with EUR, CZK, and AUD plus a **Timezone** text field for the city or region used for event times. Currency and timezone can be changed before the organization has event or payment data; after that, Evorto prevents the change.
- **Logo URL** and **Favicon URL** for organization brand assets. Admins can upload PNG, JPEG, WebP, or GIF logos; favicons also support ICO files. Externally hosted URLs are still supported. The configured favicon updates the browser tab icon.
- **SEO title** and **SEO description** for public-page previews.
- **Legal pages** for the imprint/legal notice and terms. Admins can save hosted text, an external URL, or both. The privacy policy is managed with required questions on **Member onboarding**, so a policy cannot be changed without the member-acceptance warning.
- **Allowed receipt countries** and **Allow other** for receipt submission.
- **ESN Card discounts** and optional **Buy ESNcard URL** when the organization uses ESNcard validation.

Tax rates are managed on the separate **Tax Rates** page.
`,
    });
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

  await page.goto('.');

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Before you begin" %}
Sign in as an organization administrator with access to change organization settings. Prepare approved imprint, privacy-policy, and terms text before publishing it. General settings owns the imprint and terms; **Member onboarding** owns the privacy policy and required member questions. A privacy-policy change creates a new policy version, so every member, including the administrator making the change, must accept that version before returning to protected organization work.
{% /callout %}

# Publish hosted legal pages

Start from **Events**, open **Admin Tools**, then choose **General settings**. Legal content belongs to the organization currently named in Evorto; publishing it does not change another organization.
`,
  });

  await page.getByRole('link', { name: 'Admin Tools' }).click();
  await page.getByRole('link', { name: 'General settings' }).click();
  await expect(page).toHaveURL(/\/admin\/settings$/);
  const generalSettings = page.locator('app-general-settings');
  await expect(generalSettings).not.toHaveAttribute('ngh', /.*/);
  const legalSection = generalSettings.locator('form').filter({
    has: page.getByRole('heading', {
      level: 3,
      name: 'Legal pages',
    }),
  });

  await testInfo.attach('markdown', {
    body: `
## Publish the imprint and terms

The imprint and terms each support three configurations:

- Enter only approved **Hosted ... text** when Evorto should publish the page. The public footer then opens that hosted legal page.
- Enter only an approved external **URL** when another website owns the page. The public footer opens that external address in a new tab.
- Save both when the hosted text and external page belong to the same legal configuration.

When both fields are saved, the public footer gives the external URL precedence and does not show the hosted text. Clear the URL and save again when the footer should return to the hosted legal page. The privacy-policy note links to **Member onboarding**, where its version and acceptance impact are shown together.
`,
  });

  await legalSection
    .getByRole('textbox', { name: 'Imprint / legal notice URL' })
    .fill('');
  await legalSection
    .getByRole('textbox', { name: 'Hosted imprint / legal notice text' })
    .fill(legalNoticeText);
  await expect(
    legalSection.getByRole('link', { name: 'Member onboarding' }),
  ).toBeVisible();
  await legalSection.getByRole('textbox', { name: 'Terms URL' }).fill('');
  await legalSection
    .getByRole('textbox', { name: 'Hosted terms text' })
    .fill(termsText);
  await takeScreenshot(
    testInfo,
    legalSection,
    page,
    'Hosted imprint and terms ready to publish',
  );

  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Organization settings updated')).toBeVisible();

  await legalSection.getByRole('link', { name: 'Member onboarding' }).click();
  await expect(page).toHaveURL(/\/admin\/onboarding$/);
  const onboardingSettings = page.locator('app-onboarding-settings');
  await onboardingSettings
    .getByRole('textbox', { name: 'Privacy policy URL' })
    .fill('');
  await onboardingSettings
    .getByRole('textbox', { name: 'Privacy policy text' })
    .fill(privacyPolicyText);
  await takeScreenshot(
    testInfo,
    onboardingSettings,
    page,
    'Hosted privacy policy ready to publish',
  );
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
          privacyPolicyText: true,
          privacyPolicyUrl: true,
          termsText: true,
          termsUrl: true,
        },
        where: { id: tenant.id },
      });
      return persistedTenant;
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
  await expect(
    publicPage.getByRole('link', { name: 'Login', exact: true }),
  ).toBeVisible();
  const publicFooter = publicPage.getByRole('contentinfo');
  await expect(
    publicFooter.getByRole('link', { name: 'Imprint', exact: true }),
  ).toBeVisible();
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
  await expect(
    publicPage.getByRole('heading', { level: 1, name: 'Terms' }),
  ).toBeVisible();
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

**Organization settings updated** confirms publication. A signed-out visitor must then be able to start at **Events**, follow each footer link, and read the saved text. This confirms that the content is publicly available, not only visible in the administrator form.

If Save reports an invalid URL, correct it to an absolute HTTP(S) address or remove it and use hosted text. If the imprint or terms link is missing, return to **Admin Tools** -> **General settings**. If the privacy link is missing, return to **Admin Tools** -> **Member onboarding**. Confirm that the relevant URL or hosted text was published. If the footer opens an external page while hosted text is also stored, that is the expected URL precedence; clear the URL and publish again when the hosted page should become public. Publishing a privacy-policy change deliberately blocks protected organization tasks until the current user accepts the new version; this is expected, not a failed publication.
`,
  });
});
