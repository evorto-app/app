import { adminStateFile } from '../../../helpers/user-data';
import { test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Manage tenant general settings @admin @track(playwright-specs-track-linking_20260126) @doc(ADMIN-GENERAL-SETTINGS-DOC-01)', async ({
  page,
}, testInfo) => {
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
  await page.getByRole('link', { name: 'General settings' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-general-settings'),
    page,
    'Tenant general settings',
  );

  await testInfo.attach('markdown', {
    body: `
## Current settings surface

The current general settings page supports:

- A read-only **Tenant identity** summary with tenant name, primary domain, currency, locale, timezone, and Stripe connection state.
- **Default Location** for event location search bias.
- **Site theme** for the tenant theme.
- **SEO title** and **SEO description** for tenant-level page metadata.
- **Allowed receipt countries** and **Allow other** for receipt submission.
- **ESN Card discounts** and optional **Buy ESNcard URL** when the tenant uses ESNcard validation.

Tax rates are managed on the separate **Tax Rates** page.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Relaunch scope notes

One-domain-per-tenant remains the current relaunch scope in the application schema. The page now exposes the active primary domain and runtime tenant settings for operator review, but custom domain verification, tenant logo/favicon uploads, legal/imprint/privacy/terms configuration, email sender name, review/publishing policy, registration limits, editable locale/currency/timezone, and Stripe account management are not part of this general settings page yet.
`,
  });
});
