import { userStateFile } from '../../../helpers/user-data';
import { TENANT_FORMATTING_LOCALE } from '../../../src/types/custom/tenant';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: userStateFile });

test('applies ESN discount to paid registrations @finance', async ({
  discounts,
  events,
  page,
  seeded,
}) => {
  void discounts;
  const paidEvent = events.find(
    (event) => event.id === seeded.scenario.events.paidOpen.eventId,
  );
  if (!paidEvent) {
    throw new Error('Seeded paidOpen scenario event was not found');
  }
  const option = paidEvent.registrationOptions.find(
    (registrationOption) =>
      registrationOption.id === seeded.scenario.events.paidOpen.optionId,
  );
  if (!option || !option.isPaid) {
    throw new Error('Seeded paidOpen scenario option was not found');
  }

  const expectedAmount = Math.max(0, option.price - 500); // seeded discount is price - 500

  await page.goto(`/events/${paidEvent.id}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(`/events/${paidEvent.id}`);
  const registrationOptionCard = page
    .locator('app-event-registration-option')
    .filter({
      has: page.getByRole('heading', { level: 3, name: option.title }),
    })
    .first();
  await expect(registrationOptionCard).toBeVisible({ timeout: 15_000 });
  const discountedPrice = new Intl.NumberFormat(TENANT_FORMATTING_LOCALE, {
    currency: 'EUR',
    style: 'currency',
  })
    .format(expectedAmount / 100)
    .replaceAll('\u00a0', ' ');
  await expect(
    registrationOptionCard.getByText('ESNcard discount applied'),
  ).toBeVisible();
  await expect(
    registrationOptionCard
      .locator('app-price-with-tax')
      .getByText(discountedPrice, { exact: true }),
  ).toBeVisible();
  await expect(
    registrationOptionCard.getByRole('button', {
      name: `Pay ${discountedPrice} and register`,
    }),
  ).toBeVisible();
});
