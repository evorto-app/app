import { expect } from '@playwright/test';

import { usersToAuthenticate } from '../../../../helpers/user-data';
import { test as base } from '../../../fixtures/base-test';

const user = usersToAuthenticate.find((u) => u.roles === 'user');
if (!user) {
  throw new Error('Expected user fixture to be available.');
}

const test = base.extend<{
  freeRegistrationTarget: { eventId: string } | null;
}>({
  freeRegistrationTarget: async ({ database }, use) => {
    const tenant = await database.query.tenants.findFirst({ where: { domain: 'localhost' } });
    if (!tenant) {
      await use(null);
      return;
    }

    const events = await database.query.eventInstances.findMany({
      orderBy: { start: 'asc' },
      where: { tenantId: tenant.id, status: 'APPROVED', unlisted: false },
      with: { registrationOptions: true },
    });

    for (const event of events) {
      const hasFree = event.registrationOptions.some(
        (option) =>
          !option.isPaid &&
          !option.organizingRegistration &&
          option.title === 'Participant registration' &&
          (option.confirmedSpots ?? 0) < (option.spots ?? 0),
      );
      if (!hasFree) continue;
      const existing = await database.query.eventRegistrations.findFirst({
        where: { eventId: event.id, tenantId: tenant.id, userId: user.id },
      });
      if (!existing) {
        await use({ eventId: event.id });
        return;
      }
    }

    await use(null);
  },
});

test.use({ storageState: user.stateFile });

test('registers for available free event', async ({ freeRegistrationTarget, page }) => {
  if (!freeRegistrationTarget) {
    test.skip(true, 'No suitable free event found');
    return;
  }

  // Navigate to event and register
  await page.goto(`/events/${freeRegistrationTarget.eventId}`);
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
});
