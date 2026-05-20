import type { Page } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { gaStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: gaStateFile });

const tenantSearchLabel = 'Search tenants';

const readFirstTenantRowValue = async (
  page: Page,
  label: string,
): Promise<string> => {
  const value = await page
    .locator('dt', { hasText: label })
    .first()
    .locator('..')
    .locator('dd')
    .textContent();

  expect(value?.trim()).toBeTruthy();
  return value?.trim() ?? '';
};

interface GlobalAdminTenantDocRow {
  currency: string;
  domain: string;
  id: string;
  locale: string;
  name: string;
  stripeAccountId: null | string;
  theme: string;
  timezone: string;
}

const expectGlobalAdminTenantRows = async (
  page: Page,
  tenant: GlobalAdminTenantDocRow,
) => {
  await expect(page.getByText('Primary domain').first()).toBeVisible();
  await expect(page.getByText('Tenant ID').first()).toBeVisible();
  await expect(page.getByText('Theme').first()).toBeVisible();
  await expect(page.getByText('Locale').first()).toBeVisible();
  await expect(page.getByText('Currency').first()).toBeVisible();
  await expect(page.getByText('Timezone').first()).toBeVisible();
  await expect(page.getByText('Stripe account').first()).toBeVisible();
  await expect(page.getByText(tenant.domain).first()).toBeVisible();
  await expect(page.getByText(tenant.id).first()).toBeVisible();
  await expect(page.getByText(tenant.theme).first()).toBeVisible();
  await expect(page.getByText(tenant.locale).first()).toBeVisible();
  await expect(page.getByText(tenant.currency).first()).toBeVisible();
  await expect(page.getByText(tenant.timezone).first()).toBeVisible();
  if (tenant.stripeAccountId) {
    await expect(page.getByText(tenant.stripeAccountId).first()).toBeVisible();
  } else {
    await expect(page.getByText('Not connected').first()).toBeVisible();
  }
};

const readFirstTenantPrimaryDomain = async (page: Page): Promise<string> =>
  readFirstTenantRowValue(page, 'Primary domain');

const tenantForm = (page: Page) => page.locator('form').first();

const tenantNameInput = (page: Page) =>
  tenantForm(page).locator('input').nth(0);

const tenantPrimaryDomainInput = (page: Page) =>
  tenantForm(page).locator('input').nth(1);

const tenantStripeAccountInput = (page: Page) =>
  tenantForm(page).locator('input').nth(2);

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
  await expect(tenantNameInput(page)).toBeVisible();
  await expect(tenantPrimaryDomainInput(page)).toBeVisible();
  await expect(tenantForm(page).getByRole('combobox')).toHaveCount(4);
  await expect(tenantStripeAccountInput(page)).toBeVisible();
};

test('Review global tenant administration @admin @globalAdmin', async ({
  database,
  page,
}, testInfo) => {
  const documentedTenant = await database.query.tenants.findFirst({
    where: { domain: 'localhost' },
  });
  if (!documentedTenant) {
    throw new Error('Expected generated global-admin docs tenant');
  }
  const createdTenantDomain = `docs-created-${getId().slice(0, 8)}.example.test`;
  const createdTenantName = 'Documentation Section';

  try {
    await page.goto('/global-admin/tenants');

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
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tenants' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Create tenant' }),
    ).toHaveAttribute('href', '/global-admin/tenants/create');
    await expect(page.getByLabel(tenantSearchLabel)).toBeVisible();
    await expectGlobalAdminTenantRows(page, documentedTenant);
    const primaryDomain = documentedTenant.domain;
    expect(await readFirstTenantPrimaryDomain(page)).toBe(primaryDomain);
    await page.getByLabel(tenantSearchLabel).fill('no-such-tenant');
    await expect(
      page.getByRole('heading', { name: 'No tenants match this search' }),
    ).toBeVisible();
    await page.getByLabel(tenantSearchLabel).fill(primaryDomain);
    await expect(page.getByText(primaryDomain).first()).toBeVisible();
    if (documentedTenant.stripeAccountId) {
      await page
        .getByLabel(tenantSearchLabel)
        .fill(documentedTenant.stripeAccountId);
      await expect(
        page.getByText(documentedTenant.stripeAccountId).first(),
      ).toBeVisible();
    }
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
    await page.getByLabel('Tenant name').fill(createdTenantName);
    await page.getByLabel('Primary domain').fill(createdTenantDomain);
    await expect(
      page.getByRole('button', { name: 'Create tenant' }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Create tenant' }).click();
    await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+$/);
    await expect(
      page.getByRole('heading', { level: 1, name: createdTenantName }),
    ).toBeVisible();

    const createdTenant = await database.query.tenants.findFirst({
      where: { domain: createdTenantDomain },
    });
    if (!createdTenant) {
      throw new Error(
        'Expected global-admin docs create flow to persist tenant',
      );
    }
    expect(createdTenant).toEqual(
      expect.objectContaining({
        currency: 'EUR',
        domain: createdTenantDomain,
        locale: 'en-GB',
        name: createdTenantName,
        stripeAccountId: null,
        theme: 'evorto',
        timezone: 'Europe/Berlin',
      }),
    );

    await page.goto('/global-admin/tenants');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tenants' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/global-admin\/tenants$/);
    await page.getByLabel(tenantSearchLabel).fill(primaryDomain);
    await expect(page.getByText(primaryDomain).first()).toBeVisible();
    const reviewTenantLink = page
      .locator('app-tenant-list > div')
      .filter({ hasText: primaryDomain })
      .getByRole('link', { name: 'Review tenant' });
    const reviewTenantHref = await reviewTenantLink.getAttribute('href');
    if (!reviewTenantHref) {
      throw new Error('Expected documented tenant review link href');
    }
    expect(reviewTenantHref).toMatch(/^\/global-admin\/tenants\/[^/]+$/);
    await reviewTenantLink.click();
    await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+$/);
    await expect(
      page.getByText('Read-only operational tenant review'),
    ).toBeVisible();
    await expectGlobalAdminTenantRows(page, documentedTenant);
    await expect(
      page.getByRole('link', { name: 'Open tenant domain' }),
    ).toHaveAttribute('href', `https://${primaryDomain}`);
    await expect(
      page.getByRole('link', { name: 'Edit tenant' }),
    ).toHaveAttribute('href', `${reviewTenantHref}/edit`);
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
    await expect(tenantNameInput(page)).toHaveValue(documentedTenant.name);
    await expect(tenantPrimaryDomainInput(page)).toHaveValue(primaryDomain);
    await expect(tenantStripeAccountInput(page)).toHaveValue(
      documentedTenant.stripeAccountId ?? '',
    );
    await expect(
      page.getByRole('button', { name: 'Save tenant' }),
    ).toBeEnabled();

    const updatedTenantName = `${documentedTenant.name} documentation review`;
    await page.getByLabel('Tenant name').fill(updatedTenantName);
    await page.getByRole('button', { name: 'Save tenant' }).click();
    await expect(page).toHaveURL(reviewTenantHref);
    await expect(
      page.getByRole('heading', { level: 1, name: updatedTenantName }),
    ).toBeVisible();

    const updatedTenant = await database.query.tenants.findFirst({
      where: { id: documentedTenant.id },
    });
    expect(updatedTenant).toEqual(
      expect.objectContaining({
        domain: documentedTenant.domain,
        id: documentedTenant.id,
        name: updatedTenantName,
      }),
    );

    await testInfo.attach('markdown', {
      body: `
## Current relaunch surface

The current global-admin page is a searchable tenant list with tenant creation, tenant editing, and a tenant detail review. Each entry shows the tenant name, domain, tenant id, theme, locale, currency, timezone, and Stripe account state plus connected account id for support and operational review. The tenant detail page repeats the operational fields, links to the edit form, and provides an external link to open the tenant's primary domain.

Tenant create/edit manages the one active primary domain, name, theme, locale, currency, timezone, and connected Stripe account id. The server normalizes primary domains to a single-host value and rejects duplicates before saving, so each tenant keeps one unique primary domain. The generated journey creates a temporary tenant, reads the created row back from the database, cleans it up after the doc run, then saves a tenant-name edit on the seeded fixture tenant, reads the saved row back from the database, and restores the fixture tenant after the doc run. The create/edit forms show the relaunch tenant scope directly: one active primary domain is managed here, custom-domain verification and multi-domain automation are deferred, and tenant-admin impersonation is not available in the current relaunch surface.
`,
    });
  } finally {
    await database
      .delete(schema.tenants)
      .where(eq(schema.tenants.domain, createdTenantDomain));
    await database
      .update(schema.tenants)
      .set({
        currency: documentedTenant.currency,
        domain: documentedTenant.domain,
        locale: documentedTenant.locale,
        name: documentedTenant.name,
        stripeAccountId: documentedTenant.stripeAccountId,
        theme: documentedTenant.theme,
        timezone: documentedTenant.timezone,
      })
      .where(eq(schema.tenants.id, documentedTenant.id));
  }
});
