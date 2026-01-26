import { userStateFile } from '../../../../../helpers/user-data';
import { expect, test } from '../../../../fixtures/parallel-test';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const currencyMatcher = (cents: number) => {
  const amount = cents / 100;
  const formats = [
    new Intl.NumberFormat('de-DE', { currency: 'EUR', style: 'currency' }).format(amount),
    new Intl.NumberFormat('en-US', { currency: 'EUR', style: 'currency' }).format(amount),
  ];
  return new RegExp(formats.map(escapeRegExp).join('|'));
};

test.use({ storageState: userStateFile });

test('applies ESN discount to paid registrations @finance', async ({ events, page }) => {
  // Find a paid, approved, listed event with a participant option
  const paidEvent = events.find(
    (event) =>
      event.status === 'APPROVED' &&
      event.unlisted === false &&
      event.registrationOptions.some(
        (option) => option.isPaid && option.title === 'Participant registration',
      ),
  );
  if (!paidEvent) throw new Error('No paid event found');
  const option = paidEvent.registrationOptions.find(
    (o) => o.isPaid && o.title === 'Participant registration',
  )!;
  const discount = option.discounts?.find((entry) => entry.discountType === 'esnCard');
  if (!discount) {
    test.skip(true, 'No ESN discount configured for participant registration');
    return;
  }
  const expectedAmount = discount.discountedPrice;

  await page.goto('/events', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: paidEvent.title }).click();
  const optionCard = page
    .locator('app-event-registration-option')
    .filter({ hasText: option.title });
  await expect(optionCard).toBeVisible();
  const payButton = optionCard.getByRole('button', { name: /Pay .* and register/i });
  await expect(payButton).toContainText(currencyMatcher(expectedAmount));
  await payButton.click();

  // Wait until the checkout link appears (transaction created)
  await page.getByRole('link', { name: 'Pay now' }).waitFor({ state: 'visible' });
  await expect(page.getByRole('link', { name: 'Pay now' })).toBeVisible();
});
