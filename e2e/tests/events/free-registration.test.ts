import { expect } from '@playwright/test';

import { usersToAuthenticate } from '../../../helpers/user-data';
import { test } from '../../fixtures/base-test';

test.use({ storageState: usersToAuthenticate.find((u) => u.roles === 'user')!.stateFile });

test('register for a free event as regular user', async ({ page, database }) => {
  const tenant = await database.query.tenants.findFirst({ where: { domain: 'localhost' } });
  if (!tenant) test.skip(true, 'No tenant found');

  // Find an approved, listed event with a free participant option
  const events = await database.query.eventInstances.findMany({
    orderBy: { start: 'asc' },
    where: { tenantId: tenant.id, status: 'APPROVED', unlisted: false },
    with: { registrationOptions: true },
  });
  const user = usersToAuthenticate.find((u) => u.roles === 'user')!;
  let target: (typeof events)[number] | undefined;
  for (const e of events) {
    const hasFree = e.registrationOptions.some(
      (o) =>
        !o.isPaid &&
        !o.organizingRegistration &&
        o.title === 'Participant registration' &&
        (o.confirmedSpots ?? 0) < (o.spots ?? 0),
    );
    if (!hasFree) continue;
    const existing = await database.query.eventRegistrations.findFirst({
      where: { eventId: e.id, tenantId: tenant.id, userId: user.id },
    });
    if (!existing) {
      target = e;
      break;
    }
  }
  if (!target) test.skip(true, 'No suitable free event found');
  const option = target.registrationOptions.find(
    (o) => !o.isPaid && !o.organizingRegistration && o.title === 'Participant registration',
  )!;

  // Capture confirmedSpots before
  const before = await database.query.eventRegistrationOptions.findFirst({ where: { id: option.id } });
  const confirmedBefore = before?.confirmedSpots ?? 0;

  // Navigate to event and register
  await page.goto(`/events/${target.id}`);
  // wait until loading state is gone before interacting
  await page.getByText('Loading registration status').first().waitFor({ state: 'detached' });
  await page.getByRole('button', { name: 'Register' }).first().click();

  // After registering, the status refetches; wait for the loading indicator
  await page
    .getByText('Loading registration status')
    .first()
    .waitFor({ state: 'attached', timeout: 2000 })
    .catch(() => {});
  await page.getByText('Loading registration status').first().waitFor({ state: 'detached' });

  // Confirm success copy is rendered (seed sets registeredDescription: "You are registered")
  await expect(page.getByText('You are registered')).toBeVisible();

  // Verify DB registration exists and counts updated
  const registration = await database.query.eventRegistrations.findFirst({
    where: { eventId: target.id, tenantId: tenant.id, userId: user.id, status: 'CONFIRMED' },
  });
  expect(registration).toBeTruthy();

  const after = await database.query.eventRegistrationOptions.findFirst({ where: { id: option.id } });
  const confirmedAfter = after?.confirmedSpots ?? confirmedBefore;
  expect(confirmedAfter).toBeGreaterThanOrEqual(confirmedBefore + 1);
});
