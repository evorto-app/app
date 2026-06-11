import { and, eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { seedFreeRegistrationAddon } from '../../support/utils/seed-registration-addons';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';

const regularUser = usersToAuthenticate.find((user) => user.roles === 'user');

test.use({ storageState: userStateFile });

test('registers with a free add-on and required registration question', async ({
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
  const addOnId = `addon-${getId().slice(0, 14)}`;
  const questionId = `q-${getId().slice(0, 18)}`;
  const questionTitle = 'Anything organizers should know?';
  const serverEventWindow = futureServerEventWindow();
  const [targetEvent] = await database
    .select()
    .from(schema.eventInstances)
    .where(eq(schema.eventInstances.id, targetEventId))
    .limit(1);
  if (!targetEvent) {
    throw new Error(
      'Expected seeded freeOpen event for add-on registration flow',
    );
  }
  const [targetOption] = await database
    .select()
    .from(schema.eventRegistrationOptions)
    .where(
      and(
        eq(schema.eventRegistrationOptions.eventId, targetEventId),
        eq(schema.eventRegistrationOptions.id, targetOptionId),
      ),
    )
    .limit(1);
  if (!targetOption) {
    throw new Error(
      'Expected seeded freeOpen event registration option for add-on registration flow',
    );
  }
  const originalRegistrations = await database
    .select()
    .from(schema.eventRegistrations)
    .where(
      and(
        eq(schema.eventRegistrations.eventId, targetEventId),
        eq(schema.eventRegistrations.tenantId, tenant.id),
        eq(schema.eventRegistrations.userId, regularUser.id),
      ),
    );
  const originalRegistrationIds = originalRegistrations.map(
    (registration) => registration.id,
  );
  const originalAddonPurchases = originalRegistrationIds.length
    ? await database
        .select()
        .from(schema.eventRegistrationAddonPurchases)
        .where(
          inArray(
            schema.eventRegistrationAddonPurchases.registrationId,
            originalRegistrationIds,
          ),
        )
    : [];
  const originalQuestionAnswers = originalRegistrationIds.length
    ? await database
        .select()
        .from(schema.eventRegistrationQuestionAnswers)
        .where(
          inArray(
            schema.eventRegistrationQuestionAnswers.registrationId,
            originalRegistrationIds,
          ),
        )
    : [];

  try {
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
        closeRegistrationTime: serverEventWindow.closeRegistrationTime,
        confirmedSpots: 0,
        openRegistrationTime: serverEventWindow.openRegistrationTime,
        reservedSpots: 0,
        waitlistSpots: 0,
      })
      .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: serverEventWindow.end,
        start: serverEventWindow.start,
      })
      .where(eq(schema.eventInstances.id, targetEventId));
    await seedFreeRegistrationAddon({
      addonId: addOnId,
      database,
      eventId: targetEventId,
      registrationOptionId: targetOptionId,
      title: 'Snack voucher',
    });
    await database.insert(schema.eventRegistrationQuestions).values({
      description:
        'Tell organizers anything they need to know before the event.',
      eventId: targetEventId,
      id: questionId,
      registrationOptionId: targetOptionId,
      required: true,
      sortOrder: 0,
      title: questionTitle,
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
    await expect(
      participantRegistrationCard.getByText('Add-ons'),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByText('Snack voucher'),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByLabel(questionTitle),
    ).toBeVisible();
    await expect(
      participantRegistrationCard.getByRole('button', { name: 'Register' }),
    ).toBeDisabled();
    await participantRegistrationCard.getByLabel('Quantity').fill('2');
    await participantRegistrationCard
      .getByLabel(questionTitle)
      .fill('Vegetarian snack, please.');
    await participantRegistrationCard
      .getByRole('button', { name: 'Register' })
      .click();

    await expect(page.getByText('You are registered')).toBeVisible();
    await expect(page.getByText('Selected add-ons')).toBeVisible();
    await expect(page.getByText('2 x Snack voucher')).toBeVisible();

    const [registration] = await database
      .select()
      .from(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, targetEventId),
          eq(schema.eventRegistrations.registrationOptionId, targetOptionId),
          eq(schema.eventRegistrations.status, 'CONFIRMED'),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      )
      .limit(1);
    if (!registration) {
      throw new Error(
        'Expected add-on registration flow to persist a confirmed registration',
      );
    }
    const addonPurchases = await database
      .select()
      .from(schema.eventRegistrationAddonPurchases)
      .where(
        eq(
          schema.eventRegistrationAddonPurchases.registrationId,
          registration.id,
        ),
      );
    const questionAnswers = await database
      .select()
      .from(schema.eventRegistrationQuestionAnswers)
      .where(
        eq(
          schema.eventRegistrationQuestionAnswers.registrationId,
          registration.id,
        ),
      );
    expect(addonPurchases).toEqual([
      expect.objectContaining({
        addonId: addOnId,
        quantity: 2,
        unitPrice: 0,
      }),
    ]);
    expect(questionAnswers).toEqual([
      expect.objectContaining({
        answer: 'Vegetarian snack, please.',
        questionId,
      }),
    ]);

    const [addOn] = await database
      .select()
      .from(schema.eventAddons)
      .where(eq(schema.eventAddons.id, addOnId))
      .limit(1);
    if (!addOn) {
      throw new Error('Expected seeded registration add-on to remain readable');
    }
    expect(addOn.totalAvailableQuantity).toBe(3);
  } finally {
    await database
      .delete(schema.eventRegistrations)
      .where(
        and(
          eq(schema.eventRegistrations.eventId, targetEventId),
          eq(schema.eventRegistrations.tenantId, tenant.id),
          eq(schema.eventRegistrations.userId, regularUser.id),
        ),
      );
    if (originalRegistrations.length) {
      await database
        .insert(schema.eventRegistrations)
        .values(originalRegistrations);
    }
    if (originalAddonPurchases.length) {
      await database
        .insert(schema.eventRegistrationAddonPurchases)
        .values(originalAddonPurchases);
    }
    if (originalQuestionAnswers.length) {
      await database
        .insert(schema.eventRegistrationQuestionAnswers)
        .values(originalQuestionAnswers);
    }
    await database
      .delete(schema.eventRegistrationQuestions)
      .where(eq(schema.eventRegistrationQuestions.id, questionId));
    await database
      .delete(schema.addonToEventRegistrationOptions)
      .where(eq(schema.addonToEventRegistrationOptions.addonId, addOnId));
    await database
      .delete(schema.eventAddons)
      .where(eq(schema.eventAddons.id, addOnId));
    await database
      .update(schema.eventRegistrationOptions)
      .set({
        checkedInSpots: targetOption.checkedInSpots,
        closeRegistrationTime: targetOption.closeRegistrationTime,
        confirmedSpots: targetOption.confirmedSpots,
        openRegistrationTime: targetOption.openRegistrationTime,
        reservedSpots: targetOption.reservedSpots,
        waitlistSpots: targetOption.waitlistSpots,
      })
      .where(eq(schema.eventRegistrationOptions.id, targetOptionId));
    await database
      .update(schema.eventInstances)
      .set({
        end: targetEvent.end,
        start: targetEvent.start,
      })
      .where(eq(schema.eventInstances.id, targetEventId));
  }
});
