import type { Page } from '@playwright/test';

import { DateTime } from 'luxon';
import { eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { organizerStateFile, userStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { seedFreeAddonRegistrationEvent } from '../../support/utils/seed-registration-addons';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';

const eventCard = (page: Page, title: string) =>
  page.locator('app-event-list nav a').filter({ hasText: title });

const openEventList = async (page: Page): Promise<void> => {
  await page.goto('/events');
  await expect(
    page.getByRole('heading', { exact: true, level: 1, name: 'Events' }),
  ).toBeVisible({ timeout: 15_000 });
};

test.describe('Event list card sign-up details', () => {
  test.use({ storageState: userStateFile });

  test('marks a full event on its card', async ({
    database,
    page,
    registerDatabaseCleanup,
    seeded,
    tenant,
  }) => {
    const title = `Full card ${getId().slice(0, 8)}`;
    const { eventId, optionId } = await seedFreeAddonRegistrationEvent({
      database,
      registerDatabaseCleanup,
      sourceEventId: seeded.scenario.events.freeOpen.eventId,
      sourceOptionId: seeded.scenario.events.freeOpen.optionId,
      tenantId: tenant.id,
      window: futureServerEventWindow({ startInDays: 1 }),
    });
    await database
      .update(schema.eventInstances)
      .set({ title })
      .where(eq(schema.eventInstances.id, eventId));
    const option = await database.query.eventRegistrationOptions.findFirst({
      where: { eventId, id: optionId },
    });
    if (!option) throw new Error('Expected the cloned registration option');
    await database
      .update(schema.eventRegistrationOptions)
      .set({ confirmedSpots: option.spots })
      .where(eq(schema.eventRegistrationOptions.id, optionId));

    await openEventList(page);
    await expect(eventCard(page, title)).toContainText('Event is full');
  });

  test('shows when sign-up opens on its card', async ({
    database,
    page,
    registerDatabaseCleanup,
    seeded,
    tenant,
  }) => {
    const title = `Opening card ${getId().slice(0, 8)}`;
    const window = futureServerEventWindow({
      closeRegistrationInDays: 1,
      startInDays: 1,
    });
    const opening = DateTime.fromJSDate(window.closeRegistrationTime)
      .minus({ hours: 6 })
      .toJSDate();
    const { eventId } = await seedFreeAddonRegistrationEvent({
      database,
      registerDatabaseCleanup,
      sourceEventId: seeded.scenario.events.freeOpen.eventId,
      sourceOptionId: seeded.scenario.events.freeOpen.optionId,
      tenantId: tenant.id,
      window: { ...window, openRegistrationTime: opening },
    });
    await database
      .update(schema.eventInstances)
      .set({ title })
      .where(eq(schema.eventInstances.id, eventId));

    await openEventList(page);
    const card = eventCard(page, title);
    await expect(card).toContainText('Opens');
    await expect(card.locator('time')).toHaveAttribute(
      'datetime',
      opening.toISOString(),
    );
  });

  for (const { confirmedSpots, label } of [
    { confirmedSpots: 4, label: 'Many free spots' },
    { confirmedSpots: 12, label: 'Some spots left' },
    { confirmedSpots: 17, label: 'Few spots left' },
  ]) {
    test(`shows only "${label}" to members instead of exact spot counts`, async ({
      database,
      page,
      registerDatabaseCleanup,
      seeded,
      tenant,
    }) => {
      const title = `Fill card ${getId().slice(0, 8)}`;
      const { eventId, optionId } = await seedFreeAddonRegistrationEvent({
        database,
        registerDatabaseCleanup,
        sourceEventId: seeded.scenario.events.freeOpen.eventId,
        sourceOptionId: seeded.scenario.events.freeOpen.optionId,
        tenantId: tenant.id,
        window: futureServerEventWindow({ startInDays: 1 }),
      });
      await database
        .update(schema.eventInstances)
        .set({ title })
        .where(eq(schema.eventInstances.id, eventId));
      // The seeded clone offers 20 spots, so these ratios fall in the buckets.
      await database
        .update(schema.eventRegistrationOptions)
        .set({ confirmedSpots })
        .where(eq(schema.eventRegistrationOptions.id, optionId));

      await openEventList(page);
      const card = eventCard(page, title);
      await expect(card).toContainText(label);
      await expect(card).not.toContainText(/\d+\s+of\s+\d+\s+spots/iu);
      await expect(card).not.toContainText(/\d+\s+spots?\s+left/iu);
    });
  }

  test('shows the price of a paid event on its card', async ({
    database,
    page,
    seeded,
  }) => {
    const participantOptions =
      await database.query.eventRegistrationOptions.findMany({
        where: {
          eventId: seeded.scenario.events.paidOpen.eventId,
          organizingRegistration: false,
        },
      });
    const paidOption = participantOptions.find(
      (option) => option.id === seeded.scenario.events.paidOpen.optionId,
    );
    if (!paidOption?.isPaid || paidOption.price <= 0) {
      throw new Error('Expected the seeded paid event and option');
    }
    const prices = participantOptions.map((option) => option.price);
    const lowestPrice = Math.min(...prices);
    const whole = Math.floor(lowestPrice / 100);
    const cents = String(lowestPrice % 100).padStart(2, '0');
    const amount = new RegExp(String.raw`\b${whole}[.,]${cents}\b`);

    await openEventList(page);
    const card = page.locator(
      `app-event-list nav a[href="/events/${seeded.scenario.events.paidOpen.eventId}"]`,
    );
    await expect(card).toContainText(amount);
    if (Math.max(...prices) > lowestPrice) {
      await expect(card).toContainText('From');
    }
    await expect(card).not.toContainText('Free');
  });
});

test.describe('Event list card sign-up details for organizers', () => {
  test.use({ storageState: organizerStateFile });

  test('shows the exact spot count to a viewer who may organize the event', async ({
    database,
    page,
    registerDatabaseCleanup,
    seeded,
    tenant,
  }) => {
    const title = `Organizer card ${getId().slice(0, 8)}`;
    const window = futureServerEventWindow({ startInDays: 1 });
    const { eventId, optionId } = await seedFreeAddonRegistrationEvent({
      database,
      registerDatabaseCleanup,
      sourceEventId: seeded.scenario.events.freeOpen.eventId,
      sourceOptionId: seeded.scenario.events.freeOpen.optionId,
      tenantId: tenant.id,
      window,
    });
    await database
      .update(schema.eventInstances)
      .set({ title })
      .where(eq(schema.eventInstances.id, eventId));
    await database
      .update(schema.eventRegistrationOptions)
      .set({ confirmedSpots: 8 })
      .where(eq(schema.eventRegistrationOptions.id, optionId));
    // Copy the seeded organizer option, which accepts the organizer
    // account's default organizer role, so the server sends exact spots.
    const sourceOrganizerOption =
      await database.query.eventRegistrationOptions.findFirst({
        where: {
          eventId: seeded.scenario.events.freeOpen.eventId,
          organizingRegistration: true,
        },
      });
    if (!sourceOrganizerOption) {
      throw new Error('Expected the seeded organizer registration option');
    }
    const organizerOptionId = getId();
    await database.insert(schema.eventRegistrationOptions).values({
      ...sourceOrganizerOption,
      checkedInSpots: 0,
      closeRegistrationTime: window.closeRegistrationTime,
      confirmedSpots: 1,
      eventId,
      id: organizerOptionId,
      openRegistrationTime: window.openRegistrationTime,
      reservedSpots: 0,
      spots: 3,
      waitlistSpots: 0,
    });
    // Cleanups run in reverse, so this option goes before its event.
    registerDatabaseCleanup(async (cleanupDatabase) => {
      await cleanupDatabase
        .delete(schema.eventRegistrationOptions)
        .where(eq(schema.eventRegistrationOptions.id, organizerOptionId));
    });

    await openEventList(page);
    const card = eventCard(page, title);
    await expect(card).toContainText('12 of 20 spots left');
    await expect(card).toContainText('1 of 3 organizers');
    await expect(card).not.toContainText(
      /Many free spots|Some spots left|Few spots left/u,
    );
  });
});
