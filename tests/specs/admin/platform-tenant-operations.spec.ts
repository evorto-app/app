import { gaStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: gaStateFile });

test('platform administration links to ordinary organization pages @admin @globalAdmin', async ({
  page,
  tenant,
}) => {
  await page.goto(`/global-admin/tenants/${tenant.id}`);
  await expect(
    page.getByRole('link', { name: 'Open organization', exact: true }),
  ).toHaveAttribute('href', '/');
  await expect(
    page.getByRole('link', { name: 'Edit organization', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('link', { name: 'Payment support', exact: true }),
  ).toHaveCount(0);
});
