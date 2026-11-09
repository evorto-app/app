import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { userStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import {
  seedFreeAddonRegistrationEvent,
  seedFreeRegistrationAddon,
  seedRequiredRegistrationQuestion,
} from '../../support/utils/seed-registration-addons';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';

for (const signedIn of [false, true]) {
  test.describe(
    signedIn ? 'Signed-in opening notice' : 'Anonymous opening notice',
    () => {
      test.use({
        storageState: signedIn ? userStateFile : { cookies: [], origins: [] },
      });

      test('hides all sign-up fields until the opening time', async ({
        database,
        page,
        registerDatabaseCleanup,
        seeded,
        tenant,
        testClock,
      }) => {
        const opening = testClock.plus({ days: 2 }).toJSDate();
        const { eventId, optionId } = await seedFreeAddonRegistrationEvent({
          database,
          registerDatabaseCleanup,
          sourceEventId: seeded.scenario.events.freeOpen.eventId,
          sourceOptionId: seeded.scenario.events.freeOpen.optionId,
          tenantId: tenant.id,
          window: {
            ...futureServerEventWindow(),
            openRegistrationTime: opening,
          },
        });
        await seedFreeRegistrationAddon({
          addonId: getId(),
          database,
          eventId,
          registrationOptionId: optionId,
        });
        await seedRequiredRegistrationQuestion({
          database,
          eventId,
          registrationOptionId: optionId,
        });
        await page.goto(`/events/${eventId}`);
        const card = page.locator('app-event-registration-option');
        await expect(card.getByText(/Sign-up opens in/)).toBeVisible();
        await expect(card.locator('time')).toHaveAttribute(
          'datetime',
          opening.toISOString(),
        );
        await expect(card.locator('input, textarea, button, a')).toHaveCount(0);
        await database
          .update(schema.eventRegistrationOptions)
          .set({
            openRegistrationTime: testClock.minus({ minutes: 1 }).toJSDate(),
          })
          .where(eq(schema.eventRegistrationOptions.id, optionId));
        await page.reload();
        if (signedIn) {
          await expect(
            card.getByLabel('Anything organizers should know?'),
          ).toBeVisible();
          await expect(
            card.getByRole('button', { name: 'Sign up', exact: true }),
          ).toBeVisible();
        } else {
          await expect(
            card.getByRole('link', { name: 'Sign in now' }),
          ).toBeVisible();
        }
      });
    },
  );
}

test.describe('Submission feedback', () => {
  test.use({ storageState: userStateFile });

  test('brings a rejected submission above a long form into view', async ({
    database,
    page,
    registerDatabaseCleanup,
    seeded,
    tenant,
    testClock,
  }) => {
    const { eventId, optionId } = await seedFreeAddonRegistrationEvent({
      database,
      registerDatabaseCleanup,
      sourceEventId: seeded.scenario.events.freeOpen.eventId,
      sourceOptionId: seeded.scenario.events.freeOpen.optionId,
      tenantId: tenant.id,
      window: futureServerEventWindow(),
    });
    await database.insert(schema.eventRegistrationQuestions).values(
      Array.from({ length: 12 }, (_, index) => ({
        id: getId(),
        eventId,
        registrationOptionId: optionId,
        required: false,
        sortOrder: index,
        title: `Optional answer ${index + 1}`,
      })),
    );
    await page.goto(`/events/${eventId}`);
    const card = page.locator('app-event-registration-option');
    await expect(card).toHaveAttribute('aria-busy', 'false');
    await card
      .getByLabel('Optional answer 1', { exact: true })
      .fill('Keep this answer');
    const submit = card.getByRole('button', { name: 'Sign up', exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(card.getByRole('heading').first()).not.toBeInViewport();
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        closeRegistrationTime: testClock.minus({ seconds: 30 }).toJSDate(),
      })
      .where(eq(schema.eventRegistrationOptions.id, optionId));
    await submit.click();
    const feedback = card.getByRole('alert');
    await expect(feedback).toContainText('Sign-ups are not open at this time.');
    await expect(feedback).toBeFocused();
    await expect(feedback).toBeInViewport();
    await expect(
      card.getByLabel('Optional answer 1', { exact: true }),
    ).toHaveValue('Keep this answer');
  });
});
