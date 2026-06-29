import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: userStateFile });

const seededEsnCardIdentifier = 'TEST-ESN-0001';

test('profile discounts show seeded ESN card state and block invalid saves', async ({
  database,
  discounts,
  page,
}) => {
  void discounts;
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular profile user fixture');
  }

  await page.goto('/profile#discounts');

  const profilePage = page.locator('app-user-profile');
  await expect(profilePage).toBeVisible();
  await page.getByRole('button', { name: 'Discounts' }).click();
  await expect(
    page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
  ).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText('ESN card', { exact: true })).toBeVisible();
  await expect(page.getByText(seededEsnCardIdentifier)).toBeVisible();
  await expect(page.getByText(/Status: Verified/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  const seededEsnCard = await database.query.userDiscountCards.findFirst({
    where: {
      identifier: seededEsnCardIdentifier,
      tenantId: tenant.id,
      type: 'esnCard',
      userId: regularUser.id,
    },
  });
  expect(seededEsnCard).toEqual(
    expect.objectContaining({
      identifier: seededEsnCardIdentifier,
      status: 'verified',
      type: 'esnCard',
      userId: regularUser.id,
    }),
  );

  await page.getByRole('textbox', { name: 'ESN card number' }).fill('short');
  await page.getByRole('textbox', { name: 'ESN card number' }).press('Tab');
  await expect(page.getByText(/Enter a valid ESN card number/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save ESN card' }),
  ).toBeDisabled();
});
