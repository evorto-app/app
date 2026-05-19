import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

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
  await expect(generalSettings).toBeVisible();
  await takeScreenshot(
    testInfo,
    generalSettings,
    page,
    'Tenant general settings',
  );

  await testInfo.attach('markdown', {
    body: `
## Current settings surface

The current general settings page supports:

- A **Deferred settings** summary that makes domain onboarding, brand assets, legal text pages beyond external links, locale/money settings, and operational policy gaps visible in the app instead of hiding them in docs only.
- A read-only **Tenant identity** summary with tenant name, primary domain, and Stripe connection state.
- **Default Location** for event location search bias.
- **Site theme** for the tenant theme.
- **Currency**, **Locale**, and **Timezone** selection within the supported relaunch policy.
- **Logo URL** and **Favicon URL** for externally hosted tenant brand assets. The configured favicon updates the browser tab icon.
- **SEO title** and **SEO description** for tenant-level page metadata.
- **Legal links** for tenant imprint/legal notice, privacy policy, and terms pages. Configured links appear in the public app footer.
- **Allowed receipt countries** and **Allow other** for receipt submission.
- **ESN Card discounts** and optional **Buy ESNcard URL** when the tenant uses ESNcard validation.

Tax rates are managed on the separate **Tax Rates** page.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Relaunch scope notes

One-domain-per-tenant remains the current relaunch scope in the application schema. The page now exposes the active primary domain for operator review, allows tenant admins to maintain supported currency, locale, and timezone values, and keeps an in-app deferred-settings summary for custom domain verification, tenant logo/favicon uploads beyond externally hosted URLs, hosted legal text pages, email sender name, review/publishing policy, registration limits, and Stripe account management.
`,
  });
});
