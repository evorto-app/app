import * as schema from '@db/schema';
import { and, eq } from 'drizzle-orm';

import { userStateFile, usersToAuthenticate } from '../../../../helpers/user-data';
import { expect, test } from '../../../fixtures/parallel-test';

test.use({ storageState: userStateFile });

const docUser = usersToAuthenticate.find((candidate) => candidate.stateFile === userStateFile);
if (!docUser) {
  throw new Error('ESNcard spec requires seeded regular user');
}

test('applies ESNcard pricing when card is valid', async ({ database, events, page, tenant }) => {
  const discountedEvent = events.find((event) => {
    return event.registrationOptions.some(
      (option) =>
        option.isPaid &&
        option.title === 'Participant registration' &&
        (option.discounts?.length ?? 0) > 0,
    );
  });

  if (!discountedEvent) {
    throw new Error('No discounted event found');
  }

  await database
    .update(schema.userDiscountCards)
    .set({
      status: 'verified',
      validTo: new Date(Date.now() + 1000 * 60 * 60 * 24 * 90),
    })
    .where(
      and(
        eq(schema.userDiscountCards.tenantId, tenant.id),
        eq(schema.userDiscountCards.userId, docUser.id),
        eq(schema.userDiscountCards.type, 'esnCard'),
      ),
    );

  await database
    .delete(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, discountedEvent.id),
        eq(schema.eventRegistrations.userId, docUser.id),
        eq(schema.eventRegistrations.tenantId, tenant.id),
      ),
    );

  await page.goto(`/events/${discountedEvent.id}`);
  await expect(page.getByText("You're getting")).toBeVisible();
  await expect(page.getByText('ESNcard')).toBeVisible();
});

test('does not apply ESNcard pricing when card is expired', async ({
  database,
  events,
  page,
  tenant,
}) => {
  const discountedEvent = events.find((event) => {
    return event.registrationOptions.some(
      (option) =>
        option.isPaid &&
        option.title === 'Participant registration' &&
        (option.discounts?.length ?? 0) > 0,
    );
  });

  if (!discountedEvent) {
    throw new Error('No discounted event found');
  }

  await database
    .update(schema.userDiscountCards)
    .set({
      status: 'verified',
      validTo: new Date(Date.now() - 1000 * 60 * 60 * 24),
    })
    .where(
      and(
        eq(schema.userDiscountCards.tenantId, tenant.id),
        eq(schema.userDiscountCards.userId, docUser.id),
        eq(schema.userDiscountCards.type, 'esnCard'),
      ),
    );

  await database
    .delete(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, discountedEvent.id),
        eq(schema.eventRegistrations.userId, docUser.id),
        eq(schema.eventRegistrations.tenantId, tenant.id),
      ),
    );

  await page.goto(`/events/${discountedEvent.id}`);
  await expect(page.getByText('Your card expires before this event')).toBeVisible();
  await expect(page.getByText("You're getting")).toHaveCount(0);
});
