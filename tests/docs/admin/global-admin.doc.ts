import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: gaStateFile });

test('Review global tenant administration @admin @globalAdmin @track(playwright-specs-track-linking_20260126) @doc(ADMIN-GLOBAL-TENANTS-DOC-01)', async ({
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
  await expect(page.getByText('Domain:').first()).toBeVisible();
  await expect(page.getByText('Tenant ID:').first()).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-list'),
    page,
    'Global admin tenant list',
  );

  await testInfo.attach('markdown', {
    body: `
## Current relaunch surface

The current global-admin page is a tenant list. Each entry shows the tenant name, domain, and tenant id for support and operational review.

Tenant creation, tenant editing, custom-domain verification, impersonation, and tenant-detail workflows are not implemented in this surface yet.
`,
  });
});
