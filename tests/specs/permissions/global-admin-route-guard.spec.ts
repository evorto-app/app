import { emptyStateFile, gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.describe('global admin route guard allow path', () => {
  test.use({ storageState: gaStateFile });

  test('allows platform administrators to open the tenant list @permissions @globalAdmin', async ({
    page,
  }) => {
    await page.goto('/global-admin/tenants');
    await expect(page).toHaveURL(/\/global-admin\/tenants/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tenants' }),
    ).toBeVisible();
  });

  test('allows platform administrators to open tenant details directly @permissions @globalAdmin', async ({
    page,
    tenant,
  }) => {
    await page.goto(`/global-admin/tenants/${tenant.id}`);
    await expect(page).toHaveURL(
      new RegExp(`/global-admin/tenants/${tenant.id}`),
    );
    await expect(
      page.getByText('Read-only operational tenant review'),
    ).toBeVisible();
  });

  test('allows platform administrators to open tenant creation directly @permissions @globalAdmin', async ({
    page,
  }) => {
    await page.goto('/global-admin/tenants/create');
    await expect(page).toHaveURL(/\/global-admin\/tenants\/create/);
    await expect(
      page.getByRole('heading', { name: 'Create tenant' }),
    ).toBeVisible();
  });

  test('allows platform administrators to open the Email Outbox directly @permissions @globalAdmin', async ({
    page,
  }) => {
    await page.goto('/global-admin/email-outbox');
    await expect(page).toHaveURL(/\/global-admin\/email-outbox/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Email outbox' }),
    ).toBeVisible();
  });

  test('allows platform administrators to open the audit log directly @permissions @globalAdmin', async ({
    page,
  }) => {
    await page.goto('/global-admin/audit');
    await expect(page).toHaveURL(/\/global-admin\/audit/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Platform audit log' }),
    ).toBeVisible();
  });

  test('allows platform administrators to open tenant editing directly @permissions @globalAdmin', async ({
    page,
    tenant,
  }) => {
    await page.goto(`/global-admin/tenants/${tenant.id}/edit`);
    await expect(page).toHaveURL(
      new RegExp(`/global-admin/tenants/${tenant.id}/edit`),
    );
    await expect(
      page.getByRole('heading', { name: 'Edit tenant' }),
    ).toBeVisible();
  });

  test('allows platform administrators to open target-scoped tenant operations directly @permissions @globalAdmin', async ({
    page,
    tenant,
  }) => {
    const operations = [
      { heading: 'Events', path: 'events' },
      { heading: 'Event templates', path: 'templates' },
      { heading: 'Registration inspection', path: 'scanner' },
      { heading: 'Tenant users', path: 'users' },
      { heading: 'Tenant roles', path: 'roles' },
      { heading: 'Tenant tax rates', path: 'tax-rates' },
      { heading: 'Tenant finance', path: 'finance' },
    ] as const;

    for (const operation of operations) {
      await page.goto(`/global-admin/tenants/${tenant.id}/${operation.path}`);
      await expect(page).toHaveURL(
        new RegExp(`/global-admin/tenants/${tenant.id}/${operation.path}$`),
      );
      await expect(
        page.getByRole('heading', { level: 1, name: operation.heading }),
      ).toBeVisible();
    }
  });
});

test.describe('global admin route guard deny path', () => {
  test.use({ storageState: emptyStateFile });

  test('denies signed-in users without platform administrator authority @permissions @globalAdmin', async ({
    page,
  }) => {
    await page.goto('/global-admin');
    await expect(page).toHaveURL(/\/403/);
  });

  test('denies direct tenant detail routes without platform administrator authority @permissions @globalAdmin', async ({
    page,
    tenant,
  }) => {
    await page.goto(`/global-admin/tenants/${tenant.id}`);
    await expect(page).toHaveURL(/\/403/);
  });

  test('denies direct tenant create and edit routes without platform administrator authority @permissions @globalAdmin', async ({
    page,
    tenant,
  }) => {
    await page.goto('/global-admin/tenants/create');
    await expect(page).toHaveURL(/\/403/);

    await page.goto(`/global-admin/tenants/${tenant.id}/edit`);
    await expect(page).toHaveURL(/\/403/);
  });

  test('denies direct Email Outbox access without platform administrator authority @permissions @globalAdmin', async ({
    page,
  }) => {
    await page.goto('/global-admin/email-outbox');
    await expect(page).toHaveURL(/\/403/);
  });

  test('denies direct audit-log access without platform administrator authority @permissions @globalAdmin', async ({
    page,
  }) => {
    await page.goto('/global-admin/audit');
    await expect(page).toHaveURL(/\/403/);
  });

  test('denies target-scoped tenant operations without platform administrator authority @permissions @globalAdmin', async ({
    page,
    tenant,
  }) => {
    for (const operation of [
      'events',
      'templates',
      'scanner',
      'users',
      'roles',
      'tax-rates',
      'finance',
    ]) {
      await page.goto(`/global-admin/tenants/${tenant.id}/${operation}`);
      await expect(page).toHaveURL(/\/403/);
    }
  });
});
