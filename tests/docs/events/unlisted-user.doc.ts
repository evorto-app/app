import { eq } from 'drizzle-orm';

import { userStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { waitForRegistrationPage } from '../../support/utils/event-registration-page';

test.use({ storageState: userStateFile });

test('User: understanding unlisted events', async ({
  database,
  events,
  page,
  seeded,
}, testInfo) => {
  const target = events.find(
    (event) => event.id === seeded.scenario.events.freeOpen.eventId,
  );
  const listedControl = events.find(
    (event) => event.id === seeded.scenario.events.paidOpen.eventId,
  );
  if (
    !target ||
    !listedControl ||
    target.status !== 'APPROVED' ||
    listedControl.status !== 'APPROVED' ||
    target.unlisted ||
    listedControl.unlisted
  ) {
    throw new Error(
      'Expected approved listed scenario events for the unlisted user guide',
    );
  }

  try {
    await database
      .update(schema.eventInstances)
      .set({ unlisted: true })
      .where(eq(schema.eventInstances.id, target.id));

    await page.goto('/events');
    const eventsHeading = page.getByRole('heading', {
      level: 1,
      name: 'Events',
    });
    await expect(eventsHeading).toBeVisible({ timeout: 15_000 });
    await expect(
      page.locator(`a[href="/events/${listedControl.id}"]`),
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('link', { name: target.title })).toHaveCount(0);

    await testInfo.attach('markdown', {
      body: `
# Open an unlisted event as a participant

An organizer can hide an approved event from event lists without disabling its direct link. Anyone with the exact link can open the approved event details. To register, sign in with an account that is eligible for at least one registration option.

1. Open **Events**. The unlisted event is absent even though other listed events are visible.
2. Open the complete event link shared by an organizer. Do not try to find the event by searching the list.
3. Review the event and registration options. Being unlisted does not bypass role, registration-window, capacity, or sign-in requirements.
`,
    });
    await takeScreenshot(
      testInfo,
      eventsHeading,
      page,
      'Unlisted event hidden from the participant list',
    );

    await page.goto(`/events/${target.id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: target.title }),
    ).toBeVisible({ timeout: 15_000 });
    await waitForRegistrationPage(page);
    await expect(
      page.getByRole('heading', { level: 2, name: 'Registration' }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { exact: true, name: 'Register' }),
    ).toBeVisible();
    expect(
      await database.query.eventInstances.findFirst({
        columns: { unlisted: true },
        where: { id: target.id },
      }),
    ).toEqual({ unlisted: true });

    await testInfo.attach('markdown', {
      body: `
The shared link opens the normal event page and registration area. If the link fails, confirm that it is complete, that you are on the organizer's organization address, and that the event has not been removed or changed back to draft. If registration is unavailable, read the explanation on the page; an unlisted link does not make an ineligible account eligible.
`,
    });
    await takeScreenshot(
      testInfo,
      page.locator('section').filter({ hasText: 'Registration' }),
      page,
      'Unlisted event opened from its direct link',
    );

    const tenantCookie = (await page.context().cookies()).find(
      (cookie) => cookie.name === 'evorto-tenant',
    );
    if (!tenantCookie) {
      throw new Error('Expected the isolated tenant routing cookie');
    }
    await page.context().clearCookies();
    await page.context().addCookies([tenantCookie]);
    await page.goto(`/events/${target.id}`);
    await expect(
      page.getByRole('heading', { level: 1, name: target.title }),
    ).toBeVisible({ timeout: 15_000 });
    await waitForRegistrationPage(page);
    await expect(
      page.getByRole('link', { exact: true, name: 'Log in now' }),
    ).toBeVisible();
    await testInfo.attach('markdown', {
      body: `
The direct link also opens the approved event while signed out. Select **Log in now** before registering; after login, Evorto still checks the account's roles and every normal registration rule.
`,
    });
  } finally {
    await database
      .update(schema.eventInstances)
      .set({ unlisted: target.unlisted })
      .where(eq(schema.eventInstances.id, target.id));
  }
});
