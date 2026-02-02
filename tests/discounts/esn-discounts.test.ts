import { userStateFile, usersToAuthenticate } from '../../helpers/user-data';
import * as schema from '../../src/db/schema';
import { expect, test } from '../../e2e/fixtures/parallel-test';

test.use({ storageState: userStateFile });

test('applies ESN discount to paid registrations @finance @track(playwright-specs-track-linking_20260126) @req(ESN-DISCOUNTS-TEST-01)', async ({
  database,
  events,
  page,
  tenant,
}) => {
  // Find a paid, approved, listed event with a participant option
  const paidEvent = events.find(
    (event) =>
      event.status === 'APPROVED' &&
      event.unlisted === false &&
      event.registrationOptions.some(
        (o) => o.isPaid && o.title === 'Participant registration',
      ),
  );
  if (!paidEvent) throw new Error('No paid event found');
  const option = paidEvent.registrationOptions.find(
    (o) => o.isPaid && o.title === 'Participant registration',
  )!;
  const expectedAmount = Math.max(0, option.price - 500); // seeded discount is price - 500

  await page.goto('/events', { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(/\/events/);
  await page.locator(`a[href="/events/${paidEvent.id}"]`).click();
  await expect(page).toHaveURL(`/events/${paidEvent.id}`);
  await page.getByRole('button', { name: 'Pay' }).first().click();

  // Wait until the checkout link appears (transaction created)
  await page
    .getByRole('link', { name: 'Pay now' })
    .waitFor({ state: 'visible' });

  const user = usersToAuthenticate.find((u) => u.roles === 'user')!;

  // Verify a pending transaction exists with the discounted amount
  const tx = await database.query.transactions.findFirst({
    where: {
      eventId: paidEvent.id,
      status: 'pending',
      targetUserId: user.id,
      tenantId: tenant.id,
      type: 'registration',
    },
  });

  expect(tx).toBeTruthy();
  expect(tx?.amount).toBe(expectedAmount);
});
