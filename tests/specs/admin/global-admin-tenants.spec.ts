import { expect, type Page } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { gaStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { test } from '../../support/fixtures/base-test';

test.setTimeout(120_000);

test.use({ storageState: gaStateFile });

const tenantSearchLabel = 'Search organizations';
const testPaymentAccountId =
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
  await expect(page.getByText('Website address').first()).toBeVisible();
  await expect(page.getByText('Theme').first()).toBeVisible();
  await expect(page.getByText('Currency').first()).toBeVisible();
  await expect(page.getByText('Time zone').first()).toBeVisible();
  await expect(page.getByText('Payments').first()).toBeVisible();
  await expect(page.getByText('Default theme').first()).toBeVisible();
  await expect(page.getByText('EUR').first()).toBeVisible();
  await expect(page.getByText('Berlin time').first()).toBeVisible();
};

const expectTenantFormScope = async (
  page: Page,
  options: {
    expectCreatePlaceholders?: boolean;
    expectPublicUrlMigrationGuidance?: boolean;
  } = {},
) => {
  const form = page.locator('form');

  await expect(form.getByLabel('Organization name')).toBeVisible();
  await expect(
    form.getByRole('textbox', { name: 'Website address', exact: true }),
  ).toBeVisible();
  const themeSelect = form.getByLabel('Theme');
  await expect(themeSelect).toBeVisible();
  await themeSelect.click();
  await expect(
    page.getByRole('option', { name: 'Default theme' }),
  ).toBeVisible();
  await expect(
    page.getByRole('option', { name: 'Classic Evorto theme' }),
  ).toBeVisible();
  await expect(page.getByRole('option', { name: 'ESN theme' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(form.getByLabel('Currency')).toBeVisible();
  await expect(form.getByLabel('Time zone')).toBeVisible();
  if (options.expectCreatePlaceholders) {
    await expect(
      form.getByRole('textbox', { name: 'Website address', exact: true }),
    ).toBeVisible();
  }
  await expect(form.getByRole('combobox').first()).toBeVisible();
  await expect(form.getByLabel('Reason for this change')).toBeVisible();
  if (options.expectCreatePlaceholders) {
    await expect(form.getByLabel('Privacy policy text')).toBeVisible();
    await expect(form.getByLabel('Privacy policy web address')).toBeVisible();
  }
  if (options.expectPublicUrlMigrationGuidance) {
    await expect(
      page.getByRole('heading', { name: 'Changing the website address' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Finish pending payments, refunds, and ticket transfers before changing this address.',
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Links and QR codes that use the old address will stop working.',
      ),
    ).toBeVisible();
  }
};

test('platform administrator reviews tenant list, detail, and forms @admin @globalAdmin', async ({
  database,
  registerDatabaseCleanup,
  page,
  tenantDomain,
}) => {
  if (!tenantDomain) {
    throw new Error('Expected the seeded organization address');
  }
  const [originalTenant] = await database
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.domain, tenantDomain))
    .limit(1);
  if (!originalTenant) {
    throw new Error('Expected seeded global-admin tenant');
  }
  const createdTenantDomain = `created-${getId().slice(0, 8)}.example.test`;
  const createdTenantName = 'Created Section';
  const createAuditReason = `E2E tenant creation for ${createdTenantDomain}`;
  const updateAuditReason = `E2E tenant review for ${createdTenantDomain}`;
  const cleanupIds: {
    blockedMigrationTransactionId?: string;
    createdTenantId?: string;
  } = {};

  registerDatabaseCleanup(async (cleanupDatabase) => {
    if (cleanupIds.blockedMigrationTransactionId) {
      await cleanupDatabase
        .delete(schema.transactions)
        .where(
          eq(schema.transactions.id, cleanupIds.blockedMigrationTransactionId),
        );
    }
    await cleanupDatabase
      .delete(schema.platformAuditEntries)
      .where(
        inArray(schema.platformAuditEntries.reason, [
          createAuditReason,
          updateAuditReason,
        ]),
      );
    if (cleanupIds.createdTenantId) {
      await cleanupDatabase
        .delete(schema.tenantPrivacyPolicyVersions)
        .where(
          eq(
            schema.tenantPrivacyPolicyVersions.tenantId,
            cleanupIds.createdTenantId,
          ),
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
        name: originalTenant.name,
        stripeAccountId: originalTenant.stripeAccountId,
        theme: originalTenant.theme,
        timezone: originalTenant.timezone,
      })
      .where(eq(schema.tenants.id, originalTenant.id));
  });

  await page.goto('/global-admin/tenants');

  await expect(
    page.getByRole('heading', { level: 1, name: 'Organizations' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Create organization' }),
  ).toHaveAttribute('href', '/global-admin/tenants/create');
  await expect(page.getByLabel(tenantSearchLabel)).toBeVisible();
  await expectTenantRows(page);

  await fillTenantSearch(page, 'no-such-tenant');
  await expect(
    page.getByRole('heading', { name: 'No organizations match this search' }),
  ).toBeVisible();
  await fillTenantSearch(page, originalTenant.domain);
  await expect(page.getByText(originalTenant.domain).first()).toBeVisible();
  await fillTenantSearch(page, testPaymentAccountId);
  await expect(
    page.getByRole('heading', { name: 'No organizations match this search' }),
  ).toBeVisible();

  await page.getByRole('link', { name: 'Create organization' }).click();
  await expect(
    page.getByRole('heading', { name: 'Create organization' }),
  ).toBeVisible();
  await expectTenantFormScope(page, { expectCreatePlaceholders: true });
  await expect(
    page.getByRole('button', { name: 'Create organization' }),
  ).toBeDisabled();
  const createTenantInputs = page.locator('form input');
  await createTenantInputs.first().fill(createdTenantName);
  await createTenantInputs.nth(1).fill('section.example.org/path');
  await page
    .getByLabel('Privacy policy text')
    .fill('Privacy policy for the new section.');
  await page.getByLabel('Reason for this change').fill(createAuditReason);
  await expect(
    page.getByRole('button', { name: 'Create organization' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(
    page.getByText(
      'Enter the main website address only, for example section.example.org.',
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/create$/);
  await createTenantInputs.nth(1).fill(originalTenant.domain);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(
    page.getByText(
      'This website address is already used by another organization.',
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/create$/);
  await createTenantInputs.nth(1).fill(createdTenantDomain);
  await expect(
    page.getByRole('button', { name: 'Create organization' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+$/);
  await expect(
    page.getByRole('heading', { level: 1, name: createdTenantName }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Open organization' }),
  ).toHaveAttribute('href', `https://${createdTenantDomain}`);

  const [createdTenant] = await database
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.domain, createdTenantDomain))
    .limit(1);
  if (!createdTenant) {
    throw new Error('Expected global-admin create flow to persist tenant');
  }
  cleanupIds.createdTenantId = createdTenant.id;
  expect(createdTenant).toEqual(
    expect.objectContaining({
      currency: 'EUR',
      domain: createdTenantDomain,
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

  cleanupIds.blockedMigrationTransactionId = getId();
  await database.insert(schema.transactions).values({
    amount: -1000,
    currency: createdTenant.currency,
    id: cleanupIds.blockedMigrationTransactionId,
    manuallyCreated: true,
    method: 'stripe',
    status: 'pending',
    stripeAccountId: testPaymentAccountId,
    tenantId: createdTenant.id,
    type: 'refund',
  });
  await page.getByRole('link', { name: 'Edit organization' }).click();
  await expect(
    page.getByRole('heading', { name: 'Changing the website address' }),
  ).toBeVisible();
  const blockedDomain = `blocked-${getId().slice(0, 8)}.example.test`;
  await page
    .getByRole('textbox', { name: 'Website address', exact: true })
    .fill(blockedDomain);
  await page
    .getByLabel('Reason for this change')
    .fill('Verify active-link migration protection');
  await page.getByRole('button', { name: 'Save organization' }).click();
  await expect(
    page.getByText(
      'The website address cannot be changed while payments, refunds, or ticket transfers are unfinished. Finish or cancel them and try again.',
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
    .where(
      eq(schema.transactions.id, cleanupIds.blockedMigrationTransactionId),
    );

  await page.goto('/global-admin/tenants');
  await expect(page).toHaveURL(/\/global-admin\/tenants$/);
  await fillTenantSearch(page, originalTenant.domain);
  const reviewTenantHref = `/global-admin/tenants/${originalTenant.id}`;
  const reviewTenantLink = page.locator(`a[href="${reviewTenantHref}"]`, {
    hasText: 'Review organization',
  });
  await expect(reviewTenantLink).toBeVisible();
  await reviewTenantLink.click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+$/);
  await expect(
    page.getByText(
      "Review this organization's settings and manage its events, members, roles, and finances.",
    ),
  ).toBeVisible();
  await expectTenantRows(page);
  await expect(
    page.getByRole('link', { name: 'Open organization' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { name: 'Edit organization' }),
  ).toHaveAttribute('href', `${reviewTenantHref}/edit`);

  await page.getByRole('link', { name: 'Edit organization' }).click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+\/edit$/);
  await expect(
    page.getByRole('heading', { name: 'Edit organization' }),
  ).toBeVisible();
  await expectTenantFormScope(page, {
    expectPublicUrlMigrationGuidance: true,
  });
  const tenantFormInputs = page.locator('form input');
  await expect(tenantFormInputs.first()).toHaveValue(/.+/);
  await expect(tenantFormInputs.nth(1)).toHaveValue(originalTenant.domain);
  await expect(
    page.getByRole('button', { name: 'Save organization' }),
  ).toBeDisabled();
  await expect(page.getByText('Cancel', { exact: true })).toBeVisible();

  const updatedTenantName = `${originalTenant.name} reviewed`;
  await tenantFormInputs.first().fill(updatedTenantName);
  await page.getByLabel('Reason for this change').fill(updateAuditReason);
  await expect(
    page.getByRole('button', { name: 'Save organization' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Save organization' }).click();
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
  await page.getByRole('link', { name: 'Evorto change history' }).click();
  await expect(page).toHaveURL(/\/global-admin\/audit$/);
  await expect(page.getByText(createAuditReason)).toBeVisible();
  await expect(page.getByText(updateAuditReason)).toBeVisible();
});
