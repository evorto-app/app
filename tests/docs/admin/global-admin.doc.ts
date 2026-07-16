import type { Page } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { gaStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: gaStateFile });

const tenantSearchLabel = 'Search organizations';

const fillTenantSearch = async (page: Page, value: string) => {
  const tenantList = page.locator('app-tenant-list');
  await expect(tenantList).not.toHaveAttribute('ngh', /.*/);
  const searchInput = tenantList.getByLabel(tenantSearchLabel);
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
  | 'locale'
  | 'name'
  | 'stripeAccountId'
  | 'theme'
  | 'timezone'
>;

const expectGlobalAdminTenantRows = async (
  page: Page,
  tenant: GlobalAdminTenantDocRow,
) => {
  await expect(page.getByText('Primary domain').first()).toBeVisible();
  await expect(page.getByText('Theme').first()).toBeVisible();
  await expect(page.getByText('Locale').first()).toBeVisible();
  await expect(page.getByText('Currency').first()).toBeVisible();
  await expect(page.getByText('Timezone').first()).toBeVisible();
  await expect(page.getByText('Stripe account').first()).toBeVisible();
  await expect(page.getByText(tenant.domain).first()).toBeVisible();
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

const firstTenantPrimaryDomain = (page: Page) =>
  firstTenantRowValue(page, 'Primary domain');

const tenantForm = (page: Page) => page.locator('form').first();

const tenantNameInput = (page: Page) =>
  tenantForm(page).locator('input').nth(0);

const tenantPrimaryDomainInput = (page: Page) =>
  tenantForm(page).locator('input').nth(1);

const tenantStripeAccountInput = (page: Page) =>
  tenantForm(page).locator('input').nth(2);

const expectGlobalAdminTenantFormSurface = async (
  page: Page,
  options: { create?: boolean; publicUrlMigrationGuidance?: boolean } = {},
) => {
  await expect(page.getByLabel('Organization name')).toBeVisible();
  await expect(page.getByLabel('Primary domain')).toBeVisible();
  await expect(page.getByLabel('Theme')).toBeVisible();
  await expect(page.getByLabel('Stripe account ID')).toBeVisible();
  await expect(page.getByLabel('Currency')).toBeVisible();
  await expect(page.getByLabel('Timezone')).toBeVisible();
  await expect(tenantForm(page).getByRole('combobox')).toHaveCount(3);
  await expect(tenantStripeAccountInput(page)).toBeVisible();
  await expect(page.getByLabel('Reason for platform change')).toBeVisible();
  if (options.create) {
    await expect(page.getByLabel('Privacy policy text')).toBeVisible();
    await expect(page.getByLabel('Privacy policy URL')).toBeVisible();
  }
  if (options.publicUrlMigrationGuidance) {
    await expect(
      page.getByRole('heading', { name: 'Changing the public domain' }),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Finish pending payments, refunds, and registration transfers before changing this domain.',
      ),
    ).toBeVisible();
    await expect(
      page.getByText(
        'Keep the old domain redirecting here so existing links and QR codes continue to work.',
      ),
    ).toBeVisible();
  }
};

test('Review platform organization administration @admin @globalAdmin', async ({
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
  const createAuditReason = `Documentation tenant creation for ${createdTenantDomain}`;
  const updateAuditReason = `Documentation tenant update for ${createdTenantDomain}`;
  let createdTenantId: string | undefined;

  try {
    await page.goto('/global-admin/tenants');

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Platform authority" %}
For this guide, we assume you are signed in as a platform administrator. An organization role does not grant this access.
{% /callout %}

# Organization Administration

Platform administrators can review, create, and edit organizations from **Platform administration** without becoming an organization member. Every change requires a reason and appears in the platform audit log.
`,
    });

    await expect(
      page.getByRole('heading', { name: 'Platform administration' }),
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
        page.getByText(documentedTenant.stripeAccountId).first(),
      ).toBeVisible();
    }
    await takeScreenshot(
      testInfo,
      page.locator('app-tenant-list'),
      page,
      'Platform organization list',
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
    await page.getByLabel('Reason for platform change').fill(createAuditReason);
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
      page.getByText('Domain must be a single host name'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/global-admin\/tenants\/create$/);
    await tenantPrimaryDomainInput(page).fill(documentedTenant.domain);
    await page.getByRole('button', { name: 'Create organization' }).click();
    await expect(
      page.getByText('Organization domain already exists'),
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
      throw new Error(
        'Expected global-admin docs create flow to persist tenant',
      );
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
      page.getByText("Review this organization's settings and platform tools."),
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
      'Organization detail and platform tools',
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
    await expect(tenantPrimaryDomainInput(page)).toHaveValue(
      createdTenantDomain,
    );
    await expect(tenantStripeAccountInput(page)).toHaveValue(
      createdTenant.stripeAccountId ?? '',
    );
    await expect(
      page.getByRole('button', { name: 'Save organization' }),
    ).toBeDisabled();

    const updatedTenantName = `${createdTenant.name} documentation review`;
    await tenantNameInput(page).fill(updatedTenantName);
    await page.getByLabel('Reason for platform change').fill(updateAuditReason);
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
      }),
    );
    await page.goto('/global-admin');
    await page.getByRole('link', { name: 'Platform audit log' }).click();
    await expect(page).toHaveURL(/\/global-admin\/audit$/);
    await expect(page.getByText(createAuditReason)).toBeVisible();
    await expect(page.getByText(updateAuditReason)).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-platform-audit'),
      page,
      'Platform change history',
    );

    await testInfo.attach('markdown', {
      body: `
## Organization settings and safeguards

The platform administration page lists organizations and supports creating, reviewing, and editing them. Each entry shows the organization name, primary domain, theme, locale, currency, timezone, and Stripe connection. The detail page repeats these settings, links to the edit form, and can open the organization's public site.

Create and edit manage the primary domain, name, theme, currency, timezone, and connected Stripe account. Paid event registrations and add-ons are Stripe-only, so a connected Stripe account cannot be removed while a paid template, event option, or add-on still exists. Convert those configurations to free first. Domains must be unique host names without paths, queries, fragments, credentials, or custom ports.

A public-domain change is rejected while pending payments, refunds, or registration transfers still depend on existing links. Keep the old domain redirecting to the new one so issued links and QR codes continue to work.

Each platform change requires an operator reason. The audit log shows who made the change, the organization, the action, the reason, and when it happened. Platform authority remains separate from organization membership.

The create journey also checks domain safeguards before saving: domains with paths are rejected, and duplicate primary domains return a visible error while keeping the form intact.
`,
    });
  } finally {
    await database
      .delete(schema.platformAuditEntries)
      .where(
        inArray(schema.platformAuditEntries.reason, [
          createAuditReason,
          updateAuditReason,
        ]),
      );
    if (createdTenantId) {
      await database
        .delete(schema.tenantPrivacyPolicyVersions)
        .where(
          eq(schema.tenantPrivacyPolicyVersions.tenantId, createdTenantId),
        );
    }
    await database
      .delete(schema.tenants)
      .where(eq(schema.tenants.domain, createdTenantDomain));
  }
});
