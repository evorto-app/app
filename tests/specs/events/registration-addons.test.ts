import { and, eq } from 'drizzle-orm';

import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { seedFreeRegistrationAddon } from '../../support/utils/seed-registration-addons';

const regularUser = usersToAuthenticate.find((user) => user.roles === 'user');

test.use({ storageState: userStateFile });

test('registers with a free registration add-on and shows it after registration', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  if (!regularUser) {
    throw new Error('Expected regular user fixture');
  }

  const targetEventId = seeded.scenario.events.freeOpen.eventId;
  const targetOptionId = seeded.scenario.events.freeOpen.optionId;
  const addOnId = `addon-${tenant.id.slice(0, 14)}`;
  const targetOption = await database.query.eventRegistrationOptions.findFirst({
    where: {
      eventId: targetEventId,
      id: targetOptionId,
      tenantId: tenant.id,
    },
  });
  if (!targetOption) {
    throw new Error(
      'Expected seeded freeOpen event registration option for add-on registration flow',
    );
  }

  await database
    .delete(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, targetEventId),
        eq(schema.eventRegistrations.tenantId, tenant.id),
        eq(schema.eventRegistrations.userId, regularUser.id),
      ),
    );
  await database
    .update(schema.eventRegistrationOptions)
    .set({
      confirmedSpots: 0,
      reservedSpots: 0,
      waitlistSpots: 0,
    })
    .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
  await seedFreeRegistrationAddon({
    addonId: addOnId,
    database,
    eventId: targetEventId,
    registrationOptionId: targetOptionId,
    title: 'Snack voucher',
  });

  await page.goto(`/events/${targetEventId}`);
  await page
    .getByText('Loading registration status')
    .first()
    .waitFor({ state: 'detached' });

  const participantRegistrationCard = page
    .locator('app-event-registration-option')
    .filter({ hasText: 'Participant registration' })
    .first();
  await expect(participantRegistrationCard.getByText('Add-ons')).toBeVisible();
  await expect(
    participantRegistrationCard.getByText('Snack voucher'),
  ).toBeVisible();
  await participantRegistrationCard.getByLabel('Quantity').fill('2');
  await participantRegistrationCard
    .getByRole('button', { name: 'Register' })
    .click();

  await expect(page.getByText('You are registered')).toBeVisible();
  await expect(page.getByText('Selected add-ons')).toBeVisible();
  await expect(page.getByText('2 x Snack voucher')).toBeVisible();

  const registration = await database.query.eventRegistrations.findFirst({
    where: {
      eventId: targetEventId,
      registrationOptionId: targetOptionId,
      status: 'CONFIRMED',
      tenantId: tenant.id,
      userId: regularUser.id,
    },
    with: {
      addonPurchases: true,
    },
  });
  expect(registration?.addonPurchases).toEqual([
    expect.objectContaining({
      addonId: addOnId,
      quantity: 2,
      unitPrice: 0,
    }),
  ]);

  const addOn = await database.query.eventAddons.findFirst({
    where: { id: addOnId },
  });
  expect(addOn?.totalAvailableQuantity).toBe(3);
});
