import type { Page } from '@playwright/test';

import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: gaStateFile });

const tenantSearchLabel = 'Search tenants';

const expectGlobalAdminTenantRows = async (page: Page) => {
  await expect(page.getByText('Primary domain').first()).toBeVisible();
  await expect(page.getByText('Tenant ID').first()).toBeVisible();
  await expect(page.getByText('Theme').first()).toBeVisible();
  await expect(page.getByText('Locale').first()).toBeVisible();
  await expect(page.getByText('Currency').first()).toBeVisible();
  await expect(page.getByText('Timezone').first()).toBeVisible();
  await expect(page.getByText('Stripe connection').first()).toBeVisible();
  await expect(page.getByText('localhost').first()).toBeVisible();
  await expect(page.getByText('evorto').first()).toBeVisible();
  await expect(page.getByText('en-GB').first()).toBeVisible();
  await expect(page.getByText('EUR').first()).toBeVisible();
  await expect(page.getByText('Europe/Berlin').first()).toBeVisible();
  await expect(page.getByText(/^Connected/).first()).toBeVisible();
};

const expectGlobalAdminTenantFormSurface = async (page: Page) => {
  await expect(
    page.getByRole('heading', { name: 'Relaunch tenant scope' }),
  ).toBeVisible();
  await expect(
    page.getByText('One active primary domain is managed here.'),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Custom-domain verification and multi-domain automation are deferred.',
    ),
  ).toBeVisible();
  await expect(
    page.getByText(
      'Tenant-admin impersonation is not available in the current relaunch surface.',
    ),
  ).toBeVisible();
  await expect(page.getByLabel('Tenant name')).toBeVisible();
  await expect(page.getByLabel('Primary domain')).toBeVisible();
  await expect(
    page.getByText('One primary host; custom-domain automation is deferred.'),
  ).toBeVisible();
  await expect(page.getByLabel('Theme')).toBeVisible();
  await expect(page.getByLabel('Stripe account ID')).toBeVisible();
  await expect(page.getByLabel('Currency')).toBeVisible();
  await expect(page.getByLabel('Locale')).toBeVisible();
  await expect(page.getByLabel('Timezone')).toBeVisible();
};

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

Global admins can review, create, and edit tenants from the **Global admin** area. This is a platform-level workflow: the permission is independent from normal tenant roles, but opening a tenant domain still requires valid tenant user context for tenant-scoped app pages.
`,
  });

  await expect(
    page.getByRole('heading', { name: 'Global admin' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Tenants' }).click();
  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Create tenant' }),
  ).toHaveAttribute('href', '/global-admin/tenants/create');
  await expect(page.getByLabel(tenantSearchLabel)).toBeVisible();
  await expectGlobalAdminTenantRows(page);
  await page.getByLabel(tenantSearchLabel).fill('no-such-tenant');
  await expect(
    page.getByRole('heading', { name: 'No tenants match this search' }),
  ).toBeVisible();
  await page.getByLabel(tenantSearchLabel).fill('localhost');
  await expect(page.getByText('localhost').first()).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-list'),
    page,
    'Global admin tenant list',
  );
  await page.getByRole('link', { name: 'Create tenant' }).click();
  await expect(
    page.getByRole('heading', { name: 'Create tenant' }),
  ).toBeVisible();
  await expectGlobalAdminTenantFormSurface(page);
  await expect(
    page.getByRole('button', { name: 'Create tenant' }),
  ).toBeDisabled();
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  await expect(page).toHaveURL(/\/global-admin\/tenants$/);
  const reviewTenantLink = page.getByRole('link', { name: 'Review tenant' });
  const reviewTenantHref = await reviewTenantLink.first().getAttribute('href');
  expect(reviewTenantHref).toMatch(/^\/global-admin\/tenants\/[^/]+$/);
  await reviewTenantLink.first().click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+$/);
  await expect(
    page.getByText('Read-only operational tenant review'),
  ).toBeVisible();
  await expectGlobalAdminTenantRows(page);
  await expect(
    page.getByRole('link', { name: 'Open tenant domain' }),
  ).toHaveAttribute('href', 'https://localhost');
  await expect(page.getByRole('link', { name: 'Edit tenant' })).toHaveAttribute(
    'href',
    `${reviewTenantHref}/edit`,
  );
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-detail'),
    page,
    'Global admin tenant detail',
  );
  await page.getByRole('link', { name: 'Edit tenant' }).click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+\/edit$/);
  await expect(
    page.getByRole('heading', { name: 'Edit tenant' }),
  ).toBeVisible();
  await expectGlobalAdminTenantFormSurface(page);
  await expect(page.getByLabel('Tenant name')).toHaveValue(/.+/);
  await expect(page.getByLabel('Primary domain')).toHaveValue('localhost');
  await expect(page.getByLabel('Stripe account ID')).toHaveValue(/.+/);
  await expect(page.getByRole('button', { name: 'Save tenant' })).toBeEnabled();
  await expect(page.getByRole('link', { name: 'Cancel' })).toHaveAttribute(
    'href',
    reviewTenantHref,
  );

  await testInfo.attach('markdown', {
    body: `
## Current relaunch surface

The current global-admin page is a searchable tenant list with tenant creation, tenant editing, and a tenant detail review. Each entry shows the tenant name, domain, tenant id, theme, locale, currency, timezone, and Stripe connection state plus connected account id for support and operational review. The tenant detail page repeats the operational fields, links to the edit form, and provides an external link to open the tenant's primary domain.

Tenant create/edit manages the one active primary domain, name, theme, locale, currency, timezone, and connected Stripe account id. The server normalizes primary domains to a single-host value and rejects duplicates before saving, so each tenant keeps one unique primary domain. The create/edit forms show the relaunch tenant scope directly: one active primary domain is managed here, custom-domain verification and multi-domain automation are deferred, and tenant-admin impersonation is not available in the current relaunch surface.
`,
  });
});
