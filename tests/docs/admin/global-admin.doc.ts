import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: gaStateFile });

const tenantSearchLabel = 'Search tenants';

test('Global admin: manage tenants @admin @globalAdmin', async ({
  page,
  tenant,
}, testInfo) => {
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have global tenant-administration access.
{% /callout %}

# Global Tenant Administration

Global admins use the tenant administration surface to review tenant setup, create new tenants, and maintain the relaunch-scoped operational fields for existing tenants.
`,
  });

  await page.goto('/global-admin/tenants');
  const tenantList = page.locator('app-tenant-list');
  await expect(
    tenantList.getByRole('heading', { level: 1, name: 'Tenants' }),
  ).toBeVisible();
  await expect(tenantList.getByLabel(tenantSearchLabel)).toBeVisible();
  await expect(
    tenantList.getByRole('link', { name: 'Create tenant' }),
  ).toHaveAttribute('href', '/global-admin/tenants/create');
  await expect(tenantList.getByText('Primary domain').first()).toBeVisible();
  await expect(tenantList.getByText(tenant.domain).first()).toBeVisible();
  await takeScreenshot(
    testInfo,
    tenantList.getByRole('heading', { level: 1, name: 'Tenants' }),
    page,
    'Global tenant list with search and tenant operational summary rows',
  );

  await testInfo.attach('markdown', {
    body: `
## Tenant list and search

The tenant list shows operational tenant fields that global admins need during relaunch review: primary domain, tenant id, theme, locale, currency, timezone, and Stripe connection state. Search covers those fields so admins can find a tenant by domain, name, locale, timezone, or Stripe account state.
`,
  });

  await tenantList.getByLabel(tenantSearchLabel).fill('no-such-tenant');
  await expect(
    tenantList.getByRole('heading', { name: 'No tenants match this search' }),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    tenantList.getByRole('heading', { name: 'No tenants match this search' }),
    page,
    'Empty tenant search result explaining no matching tenants were found',
  );
  await tenantList.getByLabel(tenantSearchLabel).fill(tenant.domain);
  await expect(tenantList.getByText(tenant.domain).first()).toBeVisible();

  await page.goto('/global-admin/tenants/create');
  const tenantCreate = page.locator('app-tenant-create');
  await expect(
    tenantCreate.getByRole('heading', { level: 1, name: 'Create tenant' }),
  ).toBeVisible();
  await expect(
    tenantCreate.getByRole('heading', { name: 'Relaunch tenant scope' }),
  ).toBeVisible();
  await expect(
    tenantCreate.getByText('One active primary domain is managed here.'),
  ).toBeVisible();
  await expect(
    tenantCreate.getByText(
      'Custom-domain verification and multi-domain automation are deferred.',
    ),
  ).toBeVisible();
  await expect(
    tenantCreate.getByText(
      'Tenant-admin impersonation is not available in the current relaunch surface.',
    ),
  ).toBeVisible();
  await expect(tenantCreate.getByLabel('Tenant name')).toBeVisible();
  await expect(tenantCreate.getByLabel('Primary domain')).toBeVisible();
  await expect(tenantCreate.getByLabel('Theme')).toBeVisible();
  await expect(tenantCreate.getByLabel('Stripe account ID')).toBeVisible();
  await expect(tenantCreate.getByLabel('Currency')).toBeVisible();
  await expect(tenantCreate.getByLabel('Locale')).toBeVisible();
  await expect(tenantCreate.getByLabel('Timezone')).toBeVisible();
  await takeScreenshot(
    testInfo,
    tenantCreate.getByRole('heading', { name: 'Relaunch tenant scope' }),
    page,
    'Create tenant form showing the relaunch tenant scope boundaries',
  );

  await testInfo.attach('markdown', {
    body: `
## Create tenant scope

The create form intentionally supports one active primary domain per tenant. Custom-domain verification, multi-domain onboarding, and tenant-admin impersonation are deferred relaunch scope, so the form keeps that boundary visible before the editable fields.
`,
  });

  await tenantCreate.getByLabel('Tenant name').fill('Documentation Section');
  await tenantCreate
    .getByLabel('Primary domain')
    .fill('section.example.org/path');
  await expect(
    tenantCreate.getByRole('button', { name: 'Create tenant' }),
  ).toBeEnabled();
  await tenantCreate.getByRole('button', { name: 'Create tenant' }).click();
  await expect(
    page.getByText('Domain must be a single host name'),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/create$/);
  await expect(tenantCreate.getByLabel('Primary domain')).toHaveValue(
    'section.example.org/path',
  );
  await takeScreenshot(
    testInfo,
    tenantCreate.getByLabel('Primary domain'),
    page,
    'Create tenant form preserving URL-shaped domain input after rejection',
  );

  await page.goto(`/global-admin/tenants/${tenant.id}`);
  const tenantDetail = page.locator('app-tenant-detail');
  await expect(
    tenantDetail.getByRole('heading', { level: 1, name: tenant.name }),
  ).toBeVisible();
  await expect(
    tenantDetail.getByText('Read-only operational tenant review'),
  ).toBeVisible();
  await expect(tenantDetail.getByText('Primary domain').first()).toBeVisible();
  await expect(tenantDetail.getByText(tenant.domain).first()).toBeVisible();
  await expect(
    tenantDetail.getByRole('link', { name: 'Open tenant domain' }),
  ).toHaveAttribute('href', `https://${tenant.domain}`);
  await expect(
    tenantDetail.getByRole('link', { name: 'Edit tenant' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}/edit`);
  await takeScreenshot(
    testInfo,
    tenantDetail.getByRole('heading', { level: 1, name: tenant.name }),
    page,
    'Tenant detail review with read-only operational fields and actions',
  );

  await testInfo.attach('markdown', {
    body: `
## Tenant detail and edit

Tenant detail is a read-only operational review page. From there, global admins can open the tenant domain or edit the relaunch-scoped fields. Editing uses the same scope boundaries as create tenant, and saving returns to the detail page.
`,
  });

  await page.goto(`/global-admin/tenants/${tenant.id}/edit`);
  const tenantEdit = page.locator('app-tenant-edit');
  await expect(
    tenantEdit.getByRole('heading', { level: 1, name: 'Edit tenant' }),
  ).toBeVisible();
  await expect(tenantEdit.getByLabel('Tenant name')).toHaveValue(tenant.name);
  await expect(tenantEdit.getByLabel('Primary domain')).toHaveValue(
    tenant.domain,
  );
  await expect(
    tenantEdit.getByRole('heading', { name: 'Relaunch tenant scope' }),
  ).toBeVisible();
  await expect(
    tenantEdit.getByRole('button', { name: 'Save tenant' }),
  ).toBeEnabled();
  await expect(
    tenantEdit.getByRole('link', { name: 'Cancel' }),
  ).toHaveAttribute('href', `/global-admin/tenants/${tenant.id}`);
  await takeScreenshot(
    testInfo,
    tenantEdit.getByRole('heading', { level: 1, name: 'Edit tenant' }),
    page,
    'Edit tenant form with relaunch-scoped tenant settings ready to save',
  );
});
