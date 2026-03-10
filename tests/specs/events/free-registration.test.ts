import { usersToAuthenticate } from '../../../helpers/user-data';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({
  storageState: usersToAuthenticate.find((u) => u.roles === 'user')!.stateFile,
});

test('register for a free event as regular user @track(playwright-specs-track-linking_20260126) @req(FREE-REGISTRATION-TEST-01)', async ({
  database,
  page,
  seeded,
  tenant,
}) => {
  if (!tenant) {
    test.skip(true, 'No tenant found');
    return;
  }

  const user = usersToAuthenticate.find((u) => u.roles === 'user')!;
  const targetEventId = seeded.scenario.events.freeOpen.eventId;
  const targetOptionId = seeded.scenario.events.freeOpen.optionId;

  await database
    .delete(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, targetEventId),
        eq(schema.eventRegistrations.tenantId, tenant.id),
        eq(schema.eventRegistrations.userId, user.id),
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

  // Capture confirmedSpots before
  const before = await database.query.eventRegistrationOptions.findFirst({
    where: { id: targetOptionId },
  });
  const confirmedBefore = before?.confirmedSpots ?? 0;

  // Navigate to event and register
  await page.goto(`/events/${targetEventId}`);
  await expect(page).toHaveURL(`/events/${targetEventId}`);
  // wait until loading state is gone before interacting
  await page
    .getByText('Loading registration status')
    .first()
    .waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Register' }).first().click();

  // After registering, the status refetches; wait for the loading indicator
  await page
    .getByText('Loading registration status')
    .first()
    .waitFor({ state: 'attached', timeout: 2000 })
    .catch(() => {});
  await page
    .getByText('Loading registration status')
    .first()
    .waitFor({ state: 'detached' });

  // Confirm success copy is rendered (seed sets registeredDescription: "You are registered")
  await expect(page.getByText('You are registered')).toBeVisible();

  // Verify DB registration exists and counts updated
  const registration = await database.query.eventRegistrations.findFirst({
    where: {
      eventId: targetEventId,
      registrationOptionId: targetOptionId,
      tenantId: tenant.id,
      userId: user.id,
      status: 'CONFIRMED',
    },
  });
  expect(registration).toBeTruthy();

  const after = await database.query.eventRegistrationOptions.findFirst({
    where: { id: targetOptionId },
  });
  const confirmedAfter = after?.confirmedSpots ?? confirmedBefore;
  expect(confirmedAfter).toBeGreaterThanOrEqual(confirmedBefore + 1);
});
