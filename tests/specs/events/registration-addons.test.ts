import { and, eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { DEFAULT_E2E_NOW_ISO } from '../../../helpers/testing/deterministic-test-defaults';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { seedFreeRegistrationAddon } from '../../support/utils/seed-registration-addons';

const regularUser = usersToAuthenticate.find((user) => user.roles === 'user');

const futureServerEventWindow = (): {
  closeRegistrationTime: Date;
  end: Date;
  openRegistrationTime: Date;
  start: Date;
} => {
  const serverNow = new Date(
    process.env['E2E_NOW_ISO']?.trim() || DEFAULT_E2E_NOW_ISO,
  );
  if (Number.isNaN(serverNow.getTime())) {
    throw new Error('Invalid E2E_NOW_ISO value for registration add-on test');
  }
  const start = new Date(serverNow.getTime() + 7 * 24 * 60 * 60 * 1000);

  return {
    closeRegistrationTime: new Date(
      serverNow.getTime() + 5 * 24 * 60 * 60 * 1000,
    ),
    end: new Date(start.getTime() + 2 * 60 * 60 * 1000),
    openRegistrationTime: new Date(serverNow.getTime() - 24 * 60 * 60 * 1000),
    start,
  };
};

test.use({ storageState: userStateFile });

test('registers with a free add-on and required registration question @track(playwright-specs-track-linking_20260126) @req(REGISTRATION-ADDONS-TEST-01)', async ({
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
