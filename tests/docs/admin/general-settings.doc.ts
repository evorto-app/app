import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import type { Locator, Page } from '@playwright/test';

const generalSettingsSection = (
  page: Page,
  input: {
    title: string;
    requiredText: string[];
  },
): Locator => {
  let section = page
    .locator('app-general-settings section')
    .filter({ hasText: input.title });

  for (const text of input.requiredText) {
    section = section.filter({ hasText: text });
  }

  return section.first();
};

const generalSettingsField = (page: Page, label: string): Locator =>
  page
    .locator('app-general-settings mat-form-field')
    .filter({ hasText: label })
    .first();

const generalSettingsToggle = (page: Page, label: string): Locator =>
  page
    .locator('app-general-settings mat-slide-toggle')
    .filter({ hasText: label })
    .first();

test.use({ storageState: adminStateFile });

test('Manage tenant general settings @admin', async ({ page }, testInfo) => {
  await page.goto('.');

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have the **admin:changeSettings** permission.
{% /callout %}

# Tenant General Settings

Tenant admins can manage the settings that are currently implemented for the active tenant from **Admin settings** -> **General settings**.
`,
  });

  await page.getByRole('link', { name: 'Admin Tools' }).click();
  await page.goto('/admin/settings');
  const generalSettings = page.locator('app-general-settings');
  await expect(
    generalSettings.getByRole('heading', {
      exact: true,
      level: 1,
      name: 'General settings',
    }),
  ).toBeVisible();
  await expect(
    generalSettings.getByRole('heading', {
      exact: true,
      level: 2,
      name: 'Deferred settings',
    }),
  ).toBeVisible();
  await expect(generalSettings.getByText('Domain onboarding')).toBeVisible();
  await expect(
    generalSettings.getByText(
      'Custom-domain verification and multi-domain automation are deferred.',
    ),
  ).toBeVisible();
  const deferredSettingsSummary = generalSettingsSection(page, {
    requiredText: [
      'Domain onboarding',
      'Custom-domain verification and multi-domain automation are deferred.',
    ],
    title: 'Deferred settings',
  });
  await expect(deferredSettingsSummary).toBeVisible();
  await takeScreenshot(
    testInfo,
    deferredSettingsSummary,
    page,
    'Tenant general settings page with editable relaunch configuration fields',
  );
  await expect(
    generalSettings.getByRole('heading', {
      exact: true,
      level: 2,
      name: 'Tenant identity',
    }),
  ).toBeVisible();
  await expect(
    generalSettings.getByText('Primary domain', { exact: true }),
  ).toBeVisible();
  await expect(
    generalSettings.getByText('Stripe account', { exact: true }),
  ).toBeVisible();
  const tenantIdentitySummary = generalSettingsSection(page, {
    requiredText: ['Primary domain', 'Stripe account'],
    title: 'Tenant identity',
  });
  await expect(tenantIdentitySummary).toBeVisible();
  await takeScreenshot(
    testInfo,
    tenantIdentitySummary,
    page,
    'Tenant identity summary showing primary domain and Stripe status',
  );

  await testInfo.attach('markdown', {
    body: `
## Current settings surface

The current general settings page supports:

- A **Deferred settings** summary that keeps custom-domain automation visible while pointing to editable brand, legal, and operations settings below.
- A read-only **Tenant identity** summary with tenant name, primary domain, and Stripe connection state.
- **Default Location** for event location search bias.
- **Site theme** for the tenant theme.
- **Currency**, **Locale**, and **Timezone** selection within the supported relaunch policy. These values can be changed before the tenant has event or payment data; after that, the server rejects changes unless a migration plan is handled outside this page.
- **Event review policy** for choosing reviewer approval or direct organizer publishing when an event is submitted.
- **Stripe account management** for recording whether connected-account maintenance is platform-managed or tenant-admin-managed.
- **Email sender name** for tenant email notification display names.
- **Logo URL** and **Favicon URL** for tenant brand assets. Admins can upload PNG, JPEG, WebP, or GIF logos; favicons also support ICO files. Externally hosted URLs are still supported. The configured favicon updates the browser tab icon.
- **SEO title** and **SEO description** for tenant-level page metadata.
- **Legal pages** for tenant imprint/legal notice, privacy policy, and terms. Admins can use external URLs or hosted text. External URLs appear in the public footer as off-site links; hosted text appears at \`/legal/imprint\`, \`/legal/privacy\`, and \`/legal/terms\`.
- **Allowed receipt countries** and **Allow other** for receipt submission.
- **ESN Card discounts** and optional **Buy ESNcard URL** when the tenant uses ESNcard validation.

Tax rates are managed on the separate **Tax Rates** page.
`,
  });
  await expect(generalSettings.getByLabel('Currency')).toBeVisible();
  await expect(generalSettings.getByLabel('Locale')).toBeVisible();
  await expect(generalSettings.getByLabel('Timezone')).toBeVisible();
  await expect(generalSettings.getByLabel('Event review policy')).toBeVisible();
  await expect(
    generalSettings.getByLabel('Stripe account management'),
  ).toBeVisible();
  await expect(generalSettings.getByLabel('Email sender name')).toBeVisible();
  await expect(generalSettings.getByLabel('Logo URL')).toBeVisible();
  await expect(generalSettings.getByLabel('Favicon URL')).toBeVisible();
  await expect(generalSettings.getByLabel('SEO title')).toBeVisible();
  await expect(generalSettings.getByLabel('SEO description')).toBeVisible();
  const emailSenderField = generalSettingsField(page, 'Email sender name');
  await expect(emailSenderField).toBeVisible();
  await takeScreenshot(
    testInfo,
    emailSenderField,
    page,
    'Communication and branding fields for tenant email and assets',
  );
  await expect(
    generalSettings.getByLabel('Imprint / legal notice URL'),
  ).toBeVisible();
  await expect(
    generalSettings.getByLabel('Hosted imprint / legal notice text'),
  ).toBeVisible();
  await expect(generalSettings.getByLabel('Privacy policy URL')).toBeVisible();
  await expect(
    generalSettings.getByLabel('Hosted privacy policy text'),
  ).toBeVisible();
  await expect(generalSettings.getByLabel('Terms URL')).toBeVisible();
  await expect(generalSettings.getByLabel('Hosted terms text')).toBeVisible();
  const hostedTermsField = generalSettingsField(page, 'Hosted terms text');
  await expect(hostedTermsField).toBeVisible();
  await takeScreenshot(
    testInfo,
    hostedTermsField,
    page,
    'Legal page fields for hosted imprint privacy and terms content',
  );
  await expect(
    generalSettings.getByLabel('Allowed receipt countries'),
  ).toBeVisible();
  await expect(generalSettings.getByLabel('Allow other')).toBeVisible();
  await expect(generalSettings.getByText('ESN Card discounts')).toBeVisible();
  await expect(
    generalSettings.getByRole('button', { name: 'Save' }),
  ).toBeVisible();
  const esnDiscountToggle = generalSettingsToggle(page, 'ESN Card discounts');
  await expect(esnDiscountToggle).toBeVisible();
  await takeScreenshot(
    testInfo,
    esnDiscountToggle,
    page,
    'Receipt and ESN card discount settings near the save action',
  );

  await testInfo.attach('markdown', {
    body: `
## Relaunch scope notes

One-domain-per-tenant remains the current relaunch scope in the application schema. The page now exposes the active primary domain for operator review, allows tenant admins to maintain supported currency, locale, timezone, review/publishing policy, Stripe account-management policy, email sender name, participant registration limits, uploaded or externally hosted logo/favicon assets, legal links, and hosted legal text, and keeps an in-app deferred-settings summary for custom domain verification. Currency, locale, and timezone changes are only accepted before event or payment data exists for the tenant. When one of those accepted changes is saved, Evorto reloads the app so bootstrap-level formatting defaults use the new tenant settings.
`,
  });
});
