import { userStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: userStateFile });

test('applies ESN discount to paid registrations @finance @track(playwright-specs-track-linking_20260126) @req(ESN-DISCOUNTS-TEST-01)', async ({
  events,
  page,
  seeded,
}) => {
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
  const discountedPrice = `€${(expectedAmount / 100).toFixed(2)}`;
  await expect(registrationOptionCard.getByText('ESNcard discount applied')).toBeVisible();
  await expect(
    registrationOptionCard.locator('p', { hasText: discountedPrice }).first(),
  ).toBeVisible();
  await expect(
    registrationOptionCard.getByRole('button', {
      name: `Pay ${discountedPrice} and register`,
    }),
  ).toBeVisible();
});
