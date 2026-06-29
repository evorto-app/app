import { expect, type Page } from '@playwright/test';

import { gaStateFile } from '../../../helpers/user-data';
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
  await expect(form.locator('input').first()).toBeVisible();
  if (options.expectCreatePlaceholders) {
    await expect(form.getByPlaceholder('section.example.org')).toBeVisible();
    await expect(form.getByPlaceholder('acct_...')).toBeVisible();
  }
  await expect(form.getByRole('combobox').first()).toBeVisible();
};

test('global tenant admin reviews tenant list, detail, and forms @admin @globalAdmin', async ({
  page,
}) => {
  await page.goto('/global-admin/tenants');

  await expect(
    page.locator('app-tenant-list').getByRole('heading', { name: 'Tenants' }),
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

  await page.getByText('Cancel', { exact: true }).click();
  await expect(page).toHaveURL(/\/global-admin\/tenants$/);
  const reviewTenantLink = page.getByRole('link', { name: 'Review tenant' });
  const reviewTenantHref = await reviewTenantLink.first().getAttribute('href');
  expect(reviewTenantHref).toMatch(/^\/global-admin\/tenants\/[^/]+$/);
  await reviewTenantLink.first().click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+$/);
  await expect(
    page.getByText('Read-only operational tenant review'),
  ).toBeVisible();
  await expectTenantRows(page);
  await expect(
    page.getByRole('link', { name: 'Open tenant domain' }),
  ).toHaveAttribute('href', 'https://localhost');
  await expect(page.getByRole('link', { name: 'Edit tenant' })).toHaveAttribute(
    'href',
    `${reviewTenantHref}/edit`,
  );

  await page.getByRole('link', { name: 'Edit tenant' }).click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+\/edit$/);
  await expect(
    page.getByRole('heading', { name: 'Edit tenant' }),
  ).toBeVisible();
  await expectTenantFormScope(page);
  const tenantFormInputs = page.locator('form input');
  await expect(tenantFormInputs.first()).toHaveValue(/.+/);
  await expect(tenantFormInputs.nth(1)).toHaveValue('localhost');
  await expect(page.getByRole('button', { name: 'Save tenant' })).toBeEnabled();
  await expect(page.getByText('Cancel', { exact: true })).toBeVisible();
});
