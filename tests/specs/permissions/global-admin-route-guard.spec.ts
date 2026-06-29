import { emptyStateFile, gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.describe('global admin route guard allow path', () => {
  test.use({ storageState: gaStateFile });

  test('allows global tenant admins to open the tenant list @permissions @globalAdmin', async ({
    page,
  }) => {
    await page.goto('/global-admin');
    await expect(page).toHaveURL(/\/global-admin/);
    await expect(page.getByRole('heading', { name: 'Tenants' })).toBeVisible();
  });

  test('allows global tenant admins to open tenant details directly @permissions @globalAdmin', async ({
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
});

test.describe('global admin route guard deny path', () => {
  test.use({ storageState: emptyStateFile });

  test('denies signed-in users without global tenant-admin permission @permissions @globalAdmin', async ({
    page,
  }) => {
    await page.goto('/global-admin');
    await expect(page).toHaveURL(/\/403/);
  });

  test('denies direct tenant detail routes without global tenant-admin permission @permissions @globalAdmin', async ({
    page,
    tenant,
  }) => {
    await page.goto(`/global-admin/tenants/${tenant.id}`);
    await expect(page).toHaveURL(/\/403/);
  });
});
