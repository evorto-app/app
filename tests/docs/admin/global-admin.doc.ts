import type { Page } from '@playwright/test';
import { and, eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { gaStateFile } from '../../../helpers/user-data';
import { tenantTimezoneLabel } from '../../../src/app/core/geography-labels';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: gaStateFile });

const tenantSearchLabel = 'Search organizations';

const fillTenantSearch = async (page: Page, value: string) => {
  const tenantList = page.locator('app-tenant-list');
  await expect(tenantList).not.toHaveAttribute('ngh', /.*/);
  const searchInput = tenantList.getByRole('searchbox', {
    name: tenantSearchLabel,
  });
  await expect(searchInput).toBeVisible();
  await expect(searchInput).toBeEditable();
  await searchInput.fill(value);
  await expect(searchInput).toHaveValue(value);
};

const firstTenantRowValue = (page: Page, label: string) =>
  page.locator('dt', { hasText: label }).first().locator('..').locator('dd');

type GlobalAdminTenantDocRow = Pick<
  typeof schema.tenants.$inferSelect,
  | 'currency'
  | 'domain'
  | 'id'
  | 'name'
  | 'stripeAccountId'
  | 'theme'
  | 'timezone'
>;

const expectGlobalAdminTenantRows = async (
  page: Page,
  tenant: GlobalAdminTenantDocRow,
) => {
  await expect(page.getByText('Website address').first()).toBeVisible();
  await expect(page.getByText('Theme').first()).toBeVisible();
  await expect(page.getByText('Currency').first()).toBeVisible();
  await expect(page.getByText('Time zone').first()).toBeVisible();
  await expect(
    page.getByText('Payments', { exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByText(tenant.domain).first()).toBeVisible();
  const themeLabel = {
    classic: 'Classic Evorto theme',
    esn: 'ESN theme',
    evorto: 'Default theme',
  }[tenant.theme];
  await expect(firstTenantRowValue(page, 'Theme')).toHaveText(themeLabel);
  await expect(page.getByText(tenant.currency).first()).toBeVisible();
  await expect(
    page.getByText(tenantTimezoneLabel(tenant.timezone)).first(),
  ).toBeVisible();
  await expect(
    page
      .getByText(
        tenant.stripeAccountId
          ? 'Paid sign-ups ready'
          : 'Paid sign-ups need attention',
        { exact: true },
      )
      .first(),
  ).toBeVisible();
  if (tenant.stripeAccountId) {
    await expect(page.getByText(tenant.stripeAccountId)).toHaveCount(0);
  }
};

const firstTenantPrimaryDomain = (page: Page) =>
  firstTenantRowValue(page, 'Website address');

const tenantForm = (page: Page) => page.locator('form').first();

const tenantNameInput = (page: Page) =>
  tenantForm(page).getByRole('textbox', {
    exact: true,
    name: 'Organization name',
  });

const tenantPrimaryDomainInput = (page: Page) =>
  tenantForm(page).getByRole('textbox', {
    exact: true,
    name: 'Website address',
  });

const expectGlobalAdminTenantFormSurface = async (
  page: Page,
  options: { create?: boolean; publicUrlMigrationGuidance?: boolean } = {},
) => {
  await expect(tenantNameInput(page)).toBeVisible();
  await expect(tenantPrimaryDomainInput(page)).toBeVisible();
  const themeSelect = page.getByLabel('Theme');
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
  await expect(page.getByLabel('Stripe account ID')).toHaveCount(0);
  await expect(page.getByPlaceholder('acct_...')).toHaveCount(0);
  await expect(page.getByLabel('Currency')).toBeVisible();
  const timezoneSelect = page.getByLabel('Time zone');
  await expect(timezoneSelect).toBeVisible();
  await timezoneSelect.click();
  for (const timezone of ['Prague time', 'Berlin time', 'Brisbane time']) {
    await expect(page.getByRole('option', { name: timezone })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(tenantForm(page).getByRole('combobox')).toHaveCount(3);
  await expect(page.getByLabel('Reason for this change')).toBeVisible();
  if (options.create) {
    await expect(page.getByLabel('Privacy policy text')).toBeVisible();
    await expect(page.getByLabel('Privacy policy web address')).toBeVisible();
  }
  if (options.publicUrlMigrationGuidance) {
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

test('Manage organizations @admin @globalAdmin', async ({
  database,
  page,
  registerDatabaseCleanup,
}, testInfo) => {
  const documentedTenant = await database.query.tenants.findFirst({
    where: { domain: 'localhost' },
  });
  if (!documentedTenant) {
    throw new Error('Expected generated global-admin docs tenant');
  }
  const createdTenantDomain = `docs-created-${getId().slice(0, 8)}.example.test`;
  const createdTenantName = 'Documentation Section';
  const createAuditReason = `Documentation tenant creation for ${createdTenantDomain}`;
  const updateAuditReason = `Documentation tenant update for ${createdTenantDomain}`;

  // The database fixture runs registered cleanups before closing its pool,
  // including when Playwright interrupts the test body.
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .delete(schema.tenants)
      .where(eq(schema.tenants.domain, createdTenantDomain));
  });
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .delete(schema.tenantPrivacyPolicyVersions)
      .where(
        inArray(
          schema.tenantPrivacyPolicyVersions.tenantId,
          cleanupDatabase
            .select({ id: schema.tenants.id })
            .from(schema.tenants)
            .where(eq(schema.tenants.domain, createdTenantDomain)),
        ),
      );
  });
  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .delete(schema.platformAuditEntries)
      .where(
        and(
          inArray(schema.platformAuditEntries.reason, [
            createAuditReason,
            updateAuditReason,
          ]),
          inArray(
            schema.platformAuditEntries.targetTenantId,
            cleanupDatabase
              .select({ id: schema.tenants.id })
              .from(schema.tenants)
              .where(eq(schema.tenants.domain, createdTenantDomain)),
          ),
        ),
      );
  });

  await page.goto('/global-admin/tenants');

  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Who can do this" %}
For this guide, we assume you are signed in as an Evorto administrator. An organization role does not grant this access.
{% /callout %}

## Organization administration

Evorto administrators can review, create, and edit organizations from **Evorto administration** without becoming an organization member. Every change requires a reason and appears in **Evorto change history**.
`,
  });

  await expect(
    page.getByRole('heading', { name: 'Evorto administration' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Organizations' }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Create organization' }),
  ).toHaveAttribute('href', '/global-admin/tenants/create');
  const primaryDomain = documentedTenant.domain;
  await fillTenantSearch(page, primaryDomain);
  await expectGlobalAdminTenantRows(page, documentedTenant);
  await expect(firstTenantPrimaryDomain(page)).toHaveText(primaryDomain);
  await fillTenantSearch(page, 'no-such-tenant');
  await expect(
    page.getByRole('heading', { name: 'No organizations match this search' }),
  ).toBeVisible();
  await fillTenantSearch(page, primaryDomain);
  await expect(page.getByText(primaryDomain).first()).toBeVisible();
  if (documentedTenant.stripeAccountId) {
    await fillTenantSearch(page, documentedTenant.stripeAccountId);
    await expect(
      page.getByRole('heading', { name: 'No organizations match this search' }),
    ).toBeVisible();
    await fillTenantSearch(page, primaryDomain);
    await expectGlobalAdminTenantRows(page, documentedTenant);
  }
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-list'),
    page,
    'Evorto organization list',
  );
  await page.getByRole('link', { name: 'Create organization' }).click();
  await expect(
    page.getByRole('heading', { name: 'Create organization' }),
  ).toBeVisible();
  await expectGlobalAdminTenantFormSurface(page, { create: true });
  await expect(
    page.getByRole('button', { name: 'Create organization' }),
  ).toBeDisabled();
  await tenantNameInput(page).fill(createdTenantName);
  await tenantPrimaryDomainInput(page).fill('section.example.org/path');
  await page
    .getByLabel('Privacy policy text')
    .fill('Privacy policy for the documentation section.');
  await page.getByLabel('Reason for this change').fill(createAuditReason);
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-create'),
    page,
    'Create an organization with an initial privacy policy and change reason',
  );
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
  await tenantPrimaryDomainInput(page).fill(documentedTenant.domain);
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(
    page.getByText(
      'This website address is already used by another organization.',
    ),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/create$/);
  await tenantPrimaryDomainInput(page).fill(createdTenantDomain);
  await expect(
    page.getByRole('button', { name: 'Create organization' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+$/);
  await expect(
    page.getByRole('heading', { level: 1, name: createdTenantName }),
  ).toBeVisible();

  const createdTenant = await database.query.tenants.findFirst({
    where: { domain: createdTenantDomain },
  });
  if (!createdTenant) {
    throw new Error('Expected global-admin docs create flow to persist tenant');
  }
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
      privacyPolicyText: 'Privacy policy for the documentation section.',
      tenantId: createdTenant.id,
      version: 1,
    }),
  );

  await page.goto('/global-admin/tenants');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Organizations' }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/global-admin\/tenants$/);
  await fillTenantSearch(page, createdTenantDomain);
  await expect(page.getByText(createdTenantDomain).first()).toBeVisible();
  const reviewTenantLink = page
    .locator('app-tenant-list > div')
    .filter({ hasText: createdTenantDomain })
    .getByRole('link', { name: 'Review organization' });
  const reviewTenantHref = await reviewTenantLink.getAttribute('href');
  if (!reviewTenantHref) {
    throw new Error('Expected documented tenant review link href');
  }
  expect(reviewTenantHref).toMatch(/^\/global-admin\/tenants\/[^/]+$/);
  await reviewTenantLink.click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+$/);
  await expect(
    page.getByText(
      "Review this organization's settings and manage its events, members, roles, and finances.",
    ),
  ).toBeVisible();
  await expectGlobalAdminTenantRows(page, createdTenant);
  await expect(
    page.getByRole('link', { name: 'Open organization' }),
  ).toHaveAttribute('href', `https://${createdTenantDomain}`);
  await expect(
    page.getByRole('link', { name: 'Edit organization' }),
  ).toHaveAttribute('href', `${reviewTenantHref}/edit`);
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-detail'),
    page,
    'Organization details and management',
  );
  await page.getByRole('link', { name: 'Edit organization' }).click();
  await expect(page).toHaveURL(/\/global-admin\/tenants\/[^/]+\/edit$/);
  await expect(
    page.getByRole('heading', { name: 'Edit organization' }),
  ).toBeVisible();
  await expectGlobalAdminTenantFormSurface(page, {
    publicUrlMigrationGuidance: true,
  });
  await expect(tenantNameInput(page)).toHaveValue(createdTenant.name);
  await expect(tenantPrimaryDomainInput(page)).toHaveValue(createdTenantDomain);
  await expect(
    page.getByRole('button', { name: 'Save organization' }),
  ).toBeDisabled();

  const updatedTenantName = `${createdTenant.name} documentation review`;
  await tenantNameInput(page).fill(updatedTenantName);
  await page.getByLabel('Reason for this change').fill(updateAuditReason);
  await takeScreenshot(
    testInfo,
    page.locator('app-tenant-edit'),
    page,
    'Edit organization settings with a change reason',
  );
  await expect(
    page.getByRole('button', { name: 'Save organization' }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Save organization' }).click();
  await expect(page).toHaveURL(reviewTenantHref);
  await expect(
    page.getByRole('heading', { level: 1, name: updatedTenantName }),
  ).toBeVisible();

  const updatedTenant = await database.query.tenants.findFirst({
    where: { id: createdTenant.id },
  });
  expect(updatedTenant).toEqual(
    expect.objectContaining({
      domain: createdTenant.domain,
      id: createdTenant.id,
      name: updatedTenantName,
      stripeAccountId: createdTenant.stripeAccountId,
    }),
  );
  await page.goto('/global-admin');
  await page.getByRole('link', { name: 'Evorto change history' }).click();
  await expect(page).toHaveURL(/\/global-admin\/audit$/);
  await expect(page.locator('[ngh]')).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(createAuditReason)).toBeVisible();
  await expect(page.getByText(updateAuditReason)).toBeVisible();
  const updateAuditEntry = page.getByRole('article').filter({
    has: page.getByText(updateAuditReason, { exact: true }),
  });
  await expect(
    updateAuditEntry.getByRole('heading', { name: 'Changes', exact: true }),
  ).toBeVisible();
  await expect(
    updateAuditEntry.getByRole('columnheader', {
      name: 'Changed item',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    updateAuditEntry.getByRole('cell', {
      name: createdTenant.name,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    updateAuditEntry.getByRole('cell', {
      name: updatedTenantName,
      exact: true,
    }),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-platform-audit'),
    page,
    'Evorto change history',
  );

  await testInfo.attach('markdown', {
    body: `
## Organization settings and safeguards

The Evorto administration page lists organizations and supports creating, reviewing, and editing them. Each entry shows the organization name, website address, theme, currency, time zone, and **Payments** status: **Paid sign-ups ready** or **Paid sign-ups need attention**. Account identifiers are not displayed or searchable. The detail page repeats these settings, links to the edit form, and can open the organization's public site.

Create and edit manage the website address, name, theme, currency, and time zone. New organizations have no attached payment account and show **Paid sign-ups need attention**. Contact Evorto support before adding prices. These forms do not attach, change, or remove payment accounts. Account identifiers are not entered in organization or Evorto administration settings. Enter only the organization's main website address, such as \`chapter.evorto.app\`, rather than a link to a specific page.

The website address cannot change while a payment, refund, or ticket transfer is unfinished. Wait for payments and refunds to finish, and ask the responsible member to finish or cancel an active transfer. Then try again; if the blocker remains, contact Evorto support. Existing links and QR codes that use the old address will stop working after the change.

Each change requires a reason. **Evorto change history** shows who made the change, the organization, the action, the reason, and when it happened. The visible **Changes** table compares recorded values before and after each change, and **Load older** shows earlier entries. Evorto administration access remains separate from organization membership.

Evorto rejects an address for a specific page instead of the organization's main address, or an address already used by another organization. The form stays open so the address can be corrected.
`,
  });
});
