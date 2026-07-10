import { expect, type Page } from '@playwright/test';
import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { gaStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { test } from '../../support/fixtures/base-test';

test.setTimeout(120_000);

test.use({ storageState: gaStateFile });

const tenantSearchLabel = 'Search tenants';
const expectedStripeAccountId =
  process.env['STRIPE_TEST_ACCOUNT_ID'] ?? 'acct_playwright_list';

const expectTenantRows = async (page: Page) => {
  await expect(page.getByText('Primary domain').first()).toBeVisible();
  await expect(page.getByText('Tenant ID').first()).toBeVisible();
  await expect(page.getByText('Theme').first()).toBeVisible();
  await expect(page.getByText('Locale').first()).toBeVisible();
  await expect(page.getByText('Currency').first()).toBeVisible();
  await expect(page.getByText('Timezone').first()).toBeVisible();
  await expect(page.getByText('Stripe account').first()).toBeVisible();
  await expect(page.getByText('evorto').first()).toBeVisible();
  await expect(page.getByText('en-GB').first()).toBeVisible();
  await expect(page.getByText('EUR').first()).toBeVisible();
  await expect(page.getByText('Europe/Berlin').first()).toBeVisible();
};

const expectTenantFormScope = async (
  page: Page,
  options: { expectCreatePlaceholders?: boolean } = {},
) => {
  const form = page.locator('form');

  await expect(
    page.getByRole('heading', { name: 'Relaunch tenant scope' }),
  ).toBeVisible();
  await expect(
    page.getByText(
      'One active primary domain is managed here; its secure HTTPS origin is derived from the normalized host.',
    ),
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
  await expect(form.locator('input').first()).toBeVisible();
  if (options.expectCreatePlaceholders) {
    await expect(
      form.getByRole('textbox', { name: 'Primary domain', exact: true }),
    ).toBeVisible();
    await expect(form.getByPlaceholder('acct_...')).toBeVisible();
  }
  await expect(form.getByRole('combobox').first()).toBeVisible();
};

test('global tenant admin reviews tenant list, detail, and forms @admin @globalAdmin', async ({
  database,
  page,
}) => {
  const [originalTenant] = await database
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.domain, 'localhost'))
    .limit(1);
  if (!originalTenant) {
    throw new Error('Expected seeded global-admin tenant');
  }
  const createdTenantDomain = `created-${getId().slice(0, 8)}.example.test`;
  const createdTenantName = 'Created Section';

  try {
    await page.goto('/global-admin/tenants');

    await expect(
      page.getByRole('heading', { level: 1, name: 'Tenants' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Create tenant' }),
    ).toHaveAttribute('href', '/global-admin/tenants/create');
    await expect(page.getByLabel(tenantSearchLabel)).toBeVisible();
    await expectTenantRows(page);

    await page.getByLabel(tenantSearchLabel).fill('no-such-tenant');
    await expect(
      page.getByRole('heading', { name: 'No tenants match this search' }),
    ).toBeVisible();
    await page.getByLabel(tenantSearchLabel).fill('localhost');
    await expect(page.getByText('localhost').first()).toBeVisible();
    await page.getByLabel(tenantSearchLabel).fill(expectedStripeAccountId);
    await expect(
      page.getByText(`Connected (${expectedStripeAccountId})`).first(),
    ).toBeVisible();

    await page.getByRole('link', { name: 'Create tenant' }).click();
    await expect(
      page.getByRole('heading', { name: 'Create tenant' }),
    ).toBeVisible();
    await expectTenantFormScope(page, { expectCreatePlaceholders: true });
    await expect(
      page.getByRole('button', { name: 'Create tenant' }),
    ).toBeDisabled();
    const createTenantInputs = page.locator('form input');
    await createTenantInputs.first().fill(createdTenantName);
    await createTenantInputs.nth(1).fill('section.example.org/path');
    await expect(
      page.getByRole('button', { name: 'Create tenant' }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Create tenant' }).click();
    await expect(
      page.getByText('Domain must be a single host name'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/global-admin\/tenants\/create$/);
    await createTenantInputs.nth(1).fill(originalTenant.domain);
    await page.getByRole('button', { name: 'Create tenant' }).click();
    await expect(page.getByText('Tenant domain already exists')).toBeVisible();
    await expect(page).toHaveURL(/\/global-admin\/tenants\/create$/);
    await createTenantInputs.nth(1).fill(createdTenantDomain);
    await expect(
      page.getByRole('button', { name: 'Create tenant' }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Create tenant' }).click();
    await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+$/);
    await expect(
      page.getByRole('heading', { level: 1, name: createdTenantName }),
    ).toBeVisible();

    const [createdTenant] = await database
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.domain, createdTenantDomain))
      .limit(1);
    if (!createdTenant) {
      throw new Error('Expected global-admin create flow to persist tenant');
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
    await expect(page).toHaveURL(/\/global-admin\/tenants$/);
    await page.getByLabel(tenantSearchLabel).fill('localhost');
    const reviewTenantLink = page.getByRole('link', { name: 'Review tenant' });
    const reviewTenantHref = await reviewTenantLink
      .first()
      .getAttribute('href');
    if (!reviewTenantHref) {
      throw new Error('Expected seeded tenant review link href');
    }
    expect(reviewTenantHref).toMatch(/^\/global-admin\/tenants\/[^/]+$/);
    await reviewTenantLink.first().click();
    await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+$/);
    await expect(
      page.getByText('Read-only operational tenant review'),
    ).toBeVisible();
    await expectTenantRows(page);
    await expect(page.getByRole('link', { name: 'Open tenant' })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole('link', { name: 'Edit tenant' }),
    ).toHaveAttribute('href', `${reviewTenantHref}/edit`);

    await page.getByRole('link', { name: 'Edit tenant' }).click();
    await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+\/edit$/);
    await expect(
      page.getByRole('heading', { name: 'Edit tenant' }),
    ).toBeVisible();
    await expectTenantFormScope(page);
    const tenantFormInputs = page.locator('form input');
    await expect(tenantFormInputs.first()).toHaveValue(/.+/);
    await expect(tenantFormInputs.nth(1)).toHaveValue('localhost');
    await expect(
      page.getByRole('button', { name: 'Save tenant' }),
    ).toBeEnabled();
    await expect(page.getByText('Cancel', { exact: true })).toBeVisible();

    const updatedTenantName = `${originalTenant.name} reviewed`;
    await tenantFormInputs.first().fill(updatedTenantName);
    await page.getByRole('button', { name: 'Save tenant' }).click();
    await expect(page).toHaveURL(reviewTenantHref);
    await expect(
      page.getByRole('heading', { level: 1, name: updatedTenantName }),
    ).toBeVisible();

    const [updatedTenant] = await database
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.id, originalTenant.id))
      .limit(1);
    expect(updatedTenant).toEqual(
      expect.objectContaining({
        domain: originalTenant.domain,
        id: originalTenant.id,
        name: updatedTenantName,
      }),
    );
  } finally {
    await database
      .delete(schema.tenants)
      .where(eq(schema.tenants.domain, createdTenantDomain));
    await database
      .update(schema.tenants)
      .set({
        currency: originalTenant.currency,
        domain: originalTenant.domain,
        locale: originalTenant.locale,
        name: originalTenant.name,
        stripeAccountId: originalTenant.stripeAccountId,
        theme: originalTenant.theme,
        timezone: originalTenant.timezone,
      })
      .where(eq(schema.tenants.id, originalTenant.id));
  }
});
