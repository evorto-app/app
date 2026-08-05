import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import { TENANT_FORMATTING_LOCALE } from '../../../src/types/custom/tenant';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: userStateFile });

const seededEsnCardIdentifier = 'DE-2026-000184';

test('profile discounts show seeded ESNcard state and block invalid saves', async ({
  database,
  discounts,
  page,
  tenant,
}) => {
  void discounts;
  const regularUser = usersToAuthenticate.find(
    (user) => user.stateFile === userStateFile,
  );
  if (!regularUser) {
    throw new Error('Expected regular profile user fixture');
  }
  const seededEsnCard = await database.query.userDiscountCards.findFirst({
    where: {
      identifier: seededEsnCardIdentifier,
      tenantId: tenant.id,
      type: 'esnCard',
      userId: regularUser.id,
    },
  });
  if (!seededEsnCard?.validTo) {
    throw new Error('Expected seeded ESNcard with a validity date');
  }
  expect(seededEsnCard).toEqual(
    expect.objectContaining({
      identifier: seededEsnCardIdentifier,
      status: 'verified',
      type: 'esnCard',
      userId: regularUser.id,
    }),
  );
  const validUntil = new Intl.DateTimeFormat(TENANT_FORMATTING_LOCALE, {
    day: '2-digit',
    month: '2-digit',
    timeZone: tenant.timezone,
    year: 'numeric',
  }).format(seededEsnCard.validTo);

  await page.goto('/profile/discounts');

  const profilePage = page.locator('app-profile-discounts');
  await expect(profilePage).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Discount cards' }),
  ).toBeVisible({ timeout: 15_000 });

  await expect(page.getByText('ESNcard', { exact: true })).toBeVisible();
  await expect(page.getByText(seededEsnCardIdentifier)).toBeVisible();
  await expect(
    page.getByText(`Verified — valid until ${validUntil}`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();

  await page.getByRole('textbox', { name: 'ESNcard number' }).fill('short');
  await page.getByRole('textbox', { name: 'ESNcard number' }).press('Tab');
  await expect(page.getByText(/Enter a valid ESNcard number/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save ESNcard' }),
  ).toBeDisabled();
});
