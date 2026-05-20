import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: gaStateFile });

test('Review global tenant administration @admin @globalAdmin', async ({
  page,
}, testInfo) => {
  await page.goto('/global-admin');

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have the **globalAdmin:manageTenants** permission from platform metadata.
{% /callout %}

# Global Tenant Administration

Global admins can review tenants from the **Global admin** area. This is a platform-level workflow: the permission is independent from normal tenant roles, but opening a tenant domain still requires valid tenant user context for tenant-scoped app pages.
`,
  });

  await expect(
    page.getByRole('heading', { name: 'Global admin' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Tenants' }).click();
  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await expect(page.getByLabel('Search tenants')).toBeVisible();
  await expect(page.getByText('Primary domain').first()).toBeVisible();
  await expect(page.getByText('Tenant ID').first()).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-list'),
    page,
    'Global admin tenant list',
  );
  await page.getByRole('link', { name: 'Review tenant' }).first().click();
  await expect(
    page.getByText('Read-only operational tenant review'),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open tenant domain' }),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-detail'),
    page,
    'Global admin tenant detail',
  );

  await testInfo.attach('markdown', {
    body: `
## Current relaunch surface

The current global-admin page is a searchable tenant list with a read-only tenant detail review. Each entry shows the tenant name, domain, tenant id, theme, locale, currency, timezone, and Stripe connection state for support and operational review. The tenant detail page repeats the operational fields and provides an external link to open the tenant's primary domain.

Tenant creation, tenant editing, custom-domain verification, and impersonation are not implemented in this surface yet.
`,
  });
});
