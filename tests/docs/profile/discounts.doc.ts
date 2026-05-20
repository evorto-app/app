import { userStateFile } from '../../../helpers/user-data';
import {
  esnCardActionDisabled,
  esnCardActionLabel,
  esnCardMutationErrorMessage,
  esnCardSaveDisabled,
  esnCardStatusLabel,
  esnCardSubmitPayloadFromIdentifier,
} from '../../../src/app/profile/user-profile/user-profile.esn-card';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: userStateFile });

test('Understand ESN discount card states', async ({}, testInfo) => {
  expect(esnCardStatusLabel('verified')).toBe('Verified');
  expect(esnCardStatusLabel('expired')).toBe('Expired');
  expect(esnCardStatusLabel('invalid')).toBe('Invalid');
  expect(esnCardStatusLabel('unverified')).toBe('Needs verification');
  expect(esnCardActionLabel('save', true)).toBe('Checking ESN card...');
  expect(esnCardActionLabel('refresh', true)).toBe('Refreshing...');
  expect(esnCardActionLabel('remove', true)).toBe('Removing...');
  expect(
    esnCardSaveDisabled({
      formInvalid: false,
      formSubmitting: false,
      mutationPending: true,
    }),
  ).toBe(true);
  expect(
    esnCardActionDisabled({
      deletePending: false,
      refreshPending: true,
      upsertPending: false,
    }),
  ).toBe(true);
  expect(esnCardSubmitPayloadFromIdentifier('  ESN-1234  ')).toEqual({
    identifier: 'ESN-1234',
    type: 'esnCard',
  });
  expect(
    esnCardMutationErrorMessage('save', {
      message: 'ESNcard validation provider is unavailable',
    }),
  ).toBe('ESNcard validation provider is unavailable');

  await testInfo.attach('markdown', {
    body: `
# ESN Discount Card States

The profile discount-card form stores one ESN card per user and trims the card number before validation. The save button says **Checking ESN card...** while Evorto validates the card, and refresh/remove actions show their own pending labels while those writes are in flight.

Evorto shows readable card statuses: **Verified**, **Expired**, **Invalid**, and **Needs verification**. Save, refresh, and remove stay disabled while any ESNcard write is pending, so slow provider validation or removal requests cannot overlap.

Provider outages are not treated as invalid cards. When esncard.org or the provider response is unavailable, the profile page shows the retryable provider message, such as **ESNcard validation provider is unavailable**, instead of silently storing an invalid-card state.
`,
  });
});

test('Manage ESN discount card @finance', async ({
  page,
  tenant,
}, testInfo) => {
  const seededEsnCardIdentifier = `TEST-ESN-0001-${tenant.id.slice(0, 6)}`;

  await page.goto('.');
  await page.getByRole('link', { name: 'Profile' }).click();

  const profilePage = page.locator('app-user-profile');
  await expect(profilePage).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
# ESN Discount Card

Add your ESN card to receive discounted prices on eligible events. Your card is validated against esncard.org and discounts apply only while the card is valid.
`,
  });

  const discountsSectionButton = profilePage
    .locator('nav button')
    .filter({ hasText: 'Discounts' });
  await expect(discountsSectionButton).toBeVisible();
  await discountsSectionButton.click();

  await expect(
    page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('ESN card')).toBeVisible();
  await expect(page.getByText(seededEsnCardIdentifier)).toBeVisible();
  await expect(page.getByText(/Status: Verified/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Remove' })).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { level: 2, name: 'Discount Cards' }),
    page,
    'Discount cards section',
  );

  await testInfo.attach('markdown', {
    body: `
If you already added your ESN card, you will see a readable verification status and validity here. You can refresh its status or remove it. Use the form to add or update your ESN card number. The profile page shows clear pending states while the card is checked and maps validation/provider errors into readable messages.
`,
  });

  await page.getByRole('textbox', { name: 'ESN card number' }).fill('short');
  await expect(page.getByText(/Enter a valid ESN card number/)).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save ESN card' }),
  ).toBeDisabled();
});
