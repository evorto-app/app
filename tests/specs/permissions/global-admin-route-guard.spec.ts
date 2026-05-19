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
});

test.describe('global admin route guard deny path', () => {
  test.use({ storageState: emptyStateFile });

  test('denies signed-in users without global tenant-admin permission @permissions @globalAdmin', async ({
    page,
  }) => {
    await page.goto('/global-admin');
    await expect(page).toHaveURL(/\/403/);
  });
});
