import type { Page } from '@playwright/test';
import { eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { gaStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: gaStateFile });

const tenantSearchLabel = 'Search tenants';

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
  await expect(tenantNameInput(page)).toBeVisible();
  await expect(tenantPrimaryDomainInput(page)).toBeVisible();
  await expect(
    page.getByText(
      'Checkout returns and transactional links use the secure HTTPS origin derived from this normalized domain.',
    ),
  ).toBeVisible();
  await expect(tenantForm(page).getByRole('combobox')).toHaveCount(3);
  await expect(tenantStripeAccountInput(page)).toBeVisible();
  await expect(page.getByLabel('Reason for platform change')).toBeVisible();
  if (options.create) {
    await expect(page.getByLabel('Privacy policy text')).toBeVisible();
    await expect(page.getByLabel('Privacy policy URL')).toBeVisible();
  }
  if (options.publicUrlMigrationGuidance) {
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

test('Review platform tenant administration @admin @globalAdmin', async ({
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
For this guide, we assume you are signed in with explicit platform administrator authority from verified Auth0 app metadata. Tenant roles do not grant this authority.
{% /callout %}

# Global Tenant Administration

Platform administrators can review, create, and edit tenants from the **Platform administration** area without a tenant membership. This authority is separate from tenant roles and does not grant ordinary tenant-user actions. Every tenant change requires a reason and records an application/API append-only before/after audit entry. Authorization is enforced in the Effect server layer, not by database RLS.
`,
    });

    await expect(
      page.getByRole('heading', { name: 'Platform administration' }),
    ).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tenants' }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Create tenant' }),
    ).toHaveAttribute('href', '/global-admin/tenants/create');
    const primaryDomain = documentedTenant.domain;
    await fillTenantSearch(page, primaryDomain);
    await expectGlobalAdminTenantRows(page, documentedTenant);
    await expect(firstTenantPrimaryDomain(page)).toHaveText(primaryDomain);
    await fillTenantSearch(page, 'no-such-tenant');
    await expect(
      page.getByRole('heading', { name: 'No tenants match this search' }),
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
      'Global admin tenant list',
    );
    await page.getByRole('link', { name: 'Create tenant' }).click();
    await expect(
      page.getByRole('heading', { name: 'Create tenant' }),
    ).toBeVisible();
    await expectGlobalAdminTenantFormSurface(page, { create: true });
    await expect(
      page.getByRole('button', { name: 'Create tenant' }),
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
      'Create a tenant with an initial privacy policy and audit reason',
    );
    await expect(
      page.getByRole('button', { name: 'Create tenant' }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Create tenant' }).click();
    await expect(
      page.getByText('Domain must be a single host name'),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/global-admin\/tenants\/create$/);
    await tenantPrimaryDomainInput(page).fill(documentedTenant.domain);
    await page.getByRole('button', { name: 'Create tenant' }).click();
    await expect(page.getByText('Tenant domain already exists')).toBeVisible();
    await expect(page).toHaveURL(/\/global-admin\/tenants\/create$/);
    await tenantPrimaryDomainInput(page).fill(createdTenantDomain);
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
      page.getByRole('heading', { level: 1, name: 'Tenants' }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/global-admin\/tenants$/);
    await fillTenantSearch(page, createdTenantDomain);
    await expect(page.getByText(createdTenantDomain).first()).toBeVisible();
    const reviewTenantLink = page
      .locator('app-tenant-list > div')
      .filter({ hasText: createdTenantDomain })
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
    await expectGlobalAdminTenantRows(page, createdTenant);
    await expect(
      page.getByRole('link', { name: 'Open tenant' }),
    ).toHaveAttribute('href', `https://${createdTenantDomain}`);
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
      page.getByRole('button', { name: 'Save tenant' }),
    ).toBeDisabled();

    const updatedTenantName = `${createdTenant.name} documentation review`;
    await tenantNameInput(page).fill(updatedTenantName);
    await page.getByLabel('Reason for platform change').fill(updateAuditReason);
    await takeScreenshot(
      testInfo,
      page.locator('app-tenant-edit'),
      page,
      'Edit tenant settings with an audit reason',
    );
    await expect(
      page.getByRole('button', { name: 'Save tenant' }),
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Save tenant' }).click();
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
      'Application append-only platform audit log',
    );

    await testInfo.attach('markdown', {
      body: `
## Current relaunch surface

The current global-admin page is a searchable tenant list with tenant creation, tenant editing, and a tenant detail review. Each entry shows the tenant name, primary domain, tenant id, theme, locale, currency, timezone, and Stripe account state plus connected account id for support and operational review. The tenant detail page repeats the operational fields, links to the edit form, and provides an external link to open the tenant at the secure HTTPS origin derived from its normalized primary domain.

Tenant create/edit manages the one active primary domain, name, theme, currency, timezone, and connected Stripe account id. The formatting locale remains fixed to **de-DE**. The server normalizes primary domains to a single-host value and rejects duplicates, paths, queries, fragments, credentials, and non-default ports. Transactional links and Stripe return URLs use the secure HTTPS origin derived from this normalized domain rather than request headers. The generated journey creates a temporary tenant, reads the created row back from the database, saves a tenant-name edit on that temporary tenant, verifies the saved row, and cleans it up after the doc run. The create/edit forms show the relaunch tenant scope directly: one active primary domain is managed here and its HTTPS origin is derived, custom-domain verification and multi-domain automation are deferred, and tenant-admin impersonation is not available in the current relaunch surface.

A public-URL migration is rejected while pending Stripe Checkouts or refunds, or active registration transfers, still depend on issued links. During that migration, operators must keep HTTPS redirects from the old domain to the new domain for already-issued QR codes because their encoded URLs cannot be rewritten.

Each allowed platform mutation requires an operator reason. The tenant change and its audit row commit together; the audit log shows the actor, target tenant, action, before and after snapshots, reason, and timestamp. Platform authority stays distinct from tenant membership and ordinary tenant capabilities.

The create journey also checks the one-domain guardrails before saving: domains with paths are rejected in the form before mutation, the normalized domain is read back from the database, and duplicate primary domains return a visible error while keeping the admin on the create page.
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
