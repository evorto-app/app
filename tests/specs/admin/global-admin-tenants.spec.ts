import { expect, type Page } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { gaStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { test } from '../../support/fixtures/base-test';

test.setTimeout(120_000);

test.use({ storageState: gaStateFile });

const tenantSearchLabel = 'Search tenants';
const expectedStripeAccountId =
  process.env['STRIPE_TEST_ACCOUNT_ID'] ?? 'acct_playwright_list';

const fillTenantSearch = async (page: Page, value: string) => {
  const tenantList = page.locator('app-tenant-list');
  await expect(tenantList).not.toHaveAttribute('ngh', /.*/);
  const searchInput = tenantList.getByLabel(tenantSearchLabel);
  await expect(searchInput).toBeEditable();
  await searchInput.fill(value);
  await expect(searchInput).toHaveValue(value);
};

const expectTenantRows = async (page: Page) => {
  await expect(page.getByText('Primary domain').first()).toBeVisible();
  await expect(page.getByText('Tenant ID').first()).toBeVisible();
  await expect(page.getByText('Theme').first()).toBeVisible();
  await expect(page.getByText('Locale').first()).toBeVisible();
  await expect(page.getByText('Currency').first()).toBeVisible();
  await expect(page.getByText('Timezone').first()).toBeVisible();
  await expect(page.getByText('Stripe account').first()).toBeVisible();
  await expect(page.getByText('evorto').first()).toBeVisible();
  await expect(page.getByText('de-DE').first()).toBeVisible();
  await expect(page.getByText('EUR').first()).toBeVisible();
  await expect(page.getByText('Europe/Berlin').first()).toBeVisible();
};

const expectTenantFormScope = async (
  page: Page,
  options: {
    expectCreatePlaceholders?: boolean;
    expectPublicUrlMigrationGuidance?: boolean;
  } = {},
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
  await expect(form.getByLabel('Reason for platform change')).toBeVisible();
  if (options.expectCreatePlaceholders) {
    await expect(form.getByLabel('Privacy policy text')).toBeVisible();
    await expect(form.getByLabel('Privacy policy URL')).toBeVisible();
  }
  if (options.expectPublicUrlMigrationGuidance) {
    await expect(
      page.getByRole('heading', { name: 'Public URL migration' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Domain changes are rejected while Stripe Checkouts, refunds, or registration transfers still depend on issued links.',
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Keep HTTPS redirects from the old domain to the new domain for already-issued QR codes; their encoded URLs cannot be rewritten.',
      ),
    ).toBeVisible();
  }
};

test('platform administrator reviews tenant list, detail, and forms @admin @globalAdmin', async ({
  database,
  registerDatabaseCleanup,
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
  const createAuditReason = `E2E tenant creation for ${createdTenantDomain}`;
  const updateAuditReason = `E2E tenant review for ${createdTenantDomain}`;
  let blockedMigrationTransactionId: string | undefined;
  let createdTenantId: string | undefined;

  registerDatabaseCleanup(async (cleanupDatabase) => {
    if (blockedMigrationTransactionId) {
      await cleanupDatabase
        .delete(schema.transactions)
        .where(eq(schema.transactions.id, blockedMigrationTransactionId));
    }
    await cleanupDatabase
      .delete(schema.platformAuditEntries)
      .where(
        inArray(schema.platformAuditEntries.reason, [
          createAuditReason,
          updateAuditReason,
        ]),
      );
    if (createdTenantId) {
      await cleanupDatabase
        .delete(schema.tenantPrivacyPolicyVersions)
        .where(
          eq(schema.tenantPrivacyPolicyVersions.tenantId, createdTenantId),
        );
    }
    await cleanupDatabase
      .delete(schema.tenants)
      .where(eq(schema.tenants.domain, createdTenantDomain));
    await cleanupDatabase
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
  });

  await page.goto('/global-admin/tenants');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Tenants' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Create tenant' }),
  ).toHaveAttribute('href', '/global-admin/tenants/create');
  await expect(page.getByLabel(tenantSearchLabel)).toBeVisible();
  await expectTenantRows(page);

  await fillTenantSearch(page, 'no-such-tenant');
  await expect(
    page.getByRole('heading', { name: 'No tenants match this search' }),
  ).toBeVisible();
  await fillTenantSearch(page, 'localhost');
  await expect(page.getByText('localhost').first()).toBeVisible();
  await fillTenantSearch(page, expectedStripeAccountId);
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
  await page
    .getByLabel('Privacy policy text')
    .fill('Privacy policy for the new section.');
  await page.getByLabel('Reason for platform change').fill(createAuditReason);
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
  createdTenantId = createdTenant.id;
  expect(createdTenant).toEqual(
    expect.objectContaining({
      currency: 'EUR',
      domain: createdTenantDomain,
      locale: 'de-DE',
      name: createdTenantName,
      stripeAccountId: null,
      theme: 'evorto',
      timezone: 'Europe/Berlin',
    }),
  );
  await expect(
    database.query.tenantPrivacyPolicyVersions.findFirst({
      where: { tenantId: createdTenant.id },
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      privacyPolicyText: 'Privacy policy for the new section.',
      privacyPolicyUrl: null,
      tenantId: createdTenant.id,
      version: 1,
    }),
  );
  await expect(
    database.query.platformAuditEntries.findFirst({
      where: {
        action: 'tenant.create',
        targetTenantId: createdTenant.id,
      },
    }),
  ).resolves.toEqual(
    expect.objectContaining({
      actorId: 'auth0|67bb679215c6fbc625ca098f',
      before: null,
      reason: createAuditReason,
    }),
  );

  blockedMigrationTransactionId = getId();
  await database.insert(schema.transactions).values({
    amount: 1000,
    currency: createdTenant.currency,
    id: blockedMigrationTransactionId,
    method: 'stripe',
    status: 'pending',
    tenantId: createdTenant.id,
    type: 'registration',
  });
  await page.getByRole('link', { name: 'Edit tenant' }).click();
  await expect(
    page.getByRole('heading', { name: 'Public URL migration' }),
  ).toBeVisible();
  const blockedDomain = `blocked-${getId().slice(0, 8)}.example.test`;
  await page.getByLabel('Primary domain').fill(blockedDomain);
  await page
    .getByLabel('Reason for platform change')
    .fill('Verify active-link migration protection');
  await page.getByRole('button', { name: 'Save tenant' }).click();
  await expect(
    page.getByText(
      'Tenant public URL cannot change while issued links are active. Complete or cancel every pending Stripe Checkout or refund before changing the tenant public URL.',
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+\/edit$/);
  await expect(
    database.query.tenants.findFirst({ where: { id: createdTenant.id } }),
  ).resolves.toEqual(
    expect.objectContaining({
      domain: createdTenantDomain,
    }),
  );
  await database
    .delete(schema.transactions)
    .where(eq(schema.transactions.id, blockedMigrationTransactionId));

  await page.goto('/global-admin/tenants');
  await expect(page).toHaveURL(/\/global-admin\/tenants$/);
  await fillTenantSearch(page, 'localhost');
  const reviewTenantHref = `/global-admin/tenants/${originalTenant.id}`;
  const reviewTenantLink = page.locator(`a[href="${reviewTenantHref}"]`, {
    hasText: 'Review tenant',
  });
  await expect(reviewTenantLink).toBeVisible();
  await reviewTenantLink.click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+$/);
  await expect(
    page.getByText('Read-only operational tenant review'),
  ).toBeVisible();
  await expectTenantRows(page);
  await expect(page.getByRole('link', { name: 'Open tenant' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Edit tenant' })).toHaveAttribute(
    'href',
    `${reviewTenantHref}/edit`,
  );

  await page.getByRole('link', { name: 'Edit tenant' }).click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+\/edit$/);
  await expect(
    page.getByRole('heading', { name: 'Edit tenant' }),
  ).toBeVisible();
  await expectTenantFormScope(page, {
    expectPublicUrlMigrationGuidance: true,
  });
  const tenantFormInputs = page.locator('form input');
  await expect(tenantFormInputs.first()).toHaveValue(/.+/);
  await expect(tenantFormInputs.nth(1)).toHaveValue('localhost');
  await expect(
    page.getByRole('button', { name: 'Save tenant' }),
  ).toBeDisabled();
  await expect(page.getByText('Cancel', { exact: true })).toBeVisible();

  const updatedTenantName = `${originalTenant.name} reviewed`;
  await tenantFormInputs.first().fill(updatedTenantName);
  await page.getByLabel('Reason for platform change').fill(updateAuditReason);
  await expect(page.getByRole('button', { name: 'Save tenant' })).toBeEnabled();
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
  await page.goto('/global-admin');
  await page.getByRole('link', { name: 'Platform audit log' }).click();
  await expect(page).toHaveURL(/\/global-admin\/audit$/);
  await expect(page.getByText(createAuditReason)).toBeVisible();
  await expect(page.getByText(updateAuditReason)).toBeVisible();
});
