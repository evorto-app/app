import { userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: userStateFile });

test('profile discounts show seeded ESN card state and block invalid saves', async ({
  page,
  tenant,
}) => {
  const seededEsnCardIdentifier = `TEST-ESN-0001-${tenant.id.slice(0, 6)}`;

  await page.goto('/profile#discounts');

  const profilePage = page.locator('app-user-profile');
  await expect(profilePage).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
  ).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText('ESN card')).toBeVisible();
  await expect(page.getByText(seededEsnCardIdentifier)).toBeVisible();
  await expect(page.getByText(/Status: Verified/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();

  await page.getByRole('textbox', { name: 'ESN card number' }).fill('short');
  await expect(page.getByText(/Enter a valid ESN card number/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save ESN card' }),
  ).toBeDisabled();
});
