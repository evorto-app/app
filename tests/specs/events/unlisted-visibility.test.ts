import { adminStateFile, userStateFile } from '../../../helpers/user-data';
import { eq } from 'drizzle-orm';
import type { Page } from '@playwright/test';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

const requireApprovedListedEvent = (
  events: {
    id: string;
    start: Date;
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW';
    title: string;
    unlisted: boolean;
  }[],
  eventId: string,
) => {
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event || event.status !== 'APPROVED' || event.unlisted) {
    throw new Error(
      `Expected seeded scenario event "${eventId}" to be approved and listed`,
    );
  }
  return event;
};

const waitForEventCard = async (page: Page, eventId: string) => {
  const eventCard = page.locator(`a[href="/events/${eventId}"]`);
  await expect(eventCard).toBeVisible({ timeout: 15_000 });
  return eventCard;
};

test.describe('Unlisted events visibility', () => {
  test.use({ storageState: userStateFile });

  test('regular user does not see unlisted in list', async ({
    database,
    events,
    page,
    seeded,
  }) => {
    const event = requireApprovedListedEvent(
      events,
      seeded.scenario.events.freeOpen.eventId,
    );
    const controlEvent = requireApprovedListedEvent(
      events,
      seeded.scenario.events.paidOpen.eventId,
    );

    try {
      await database
        .update(schema.eventInstances)
        .set({ unlisted: true })
        .where(eq(schema.eventInstances.id, event.id));

      await page.goto('/events');
      await waitForEventCard(page, controlEvent.id);
      await expect(page.getByRole('link', { name: event.title })).toHaveCount(
        0,
      );
      await expect(
        page.locator('app-event-list nav').getByText('unlisted'),
      ).toHaveCount(0);
    } finally {
      await database
        .update(schema.eventInstances)
        .set({ unlisted: event.unlisted })
        .where(eq(schema.eventInstances.id, event.id));
    }
  });

  test('regular user can open unlisted via direct link', async ({
    database,
    events,
    page,
    seeded,
  }) => {
    const event = requireApprovedListedEvent(
      events,
      seeded.scenario.events.freeOpen.eventId,
    );

    try {
      await database
        .update(schema.eventInstances)
        .set({ unlisted: true })
        .where(eq(schema.eventInstances.id, event.id));

      await page.goto(`/events/${event.id}`);
      await expect(
        page.getByRole('heading', { name: event.title }),
      ).toBeVisible();
    } finally {
      await database
        .update(schema.eventInstances)
        .set({ unlisted: event.unlisted })
        .where(eq(schema.eventInstances.id, event.id));
    }
  });
});

test.describe('Admin can see unlisted', () => {
  test.use({ storageState: adminStateFile });

  test('admin sees unlisted in list with indicator', async ({
    database,
    events,
    page,
    seeded,
  }) => {
    const event = requireApprovedListedEvent(
      events,
      seeded.scenario.events.freeOpen.eventId,
    );

    try {
      await database
        .update(schema.eventInstances)
        .set({ unlisted: true })
        .where(eq(schema.eventInstances.id, event.id));

      await page.goto('/events');
      const eventCard = await waitForEventCard(page, event.id);
      await expect(
        eventCard.getByText('unlisted', { exact: true }),
      ).toBeVisible();
    } finally {
      await database
        .update(schema.eventInstances)
        .set({ unlisted: event.unlisted })
        .where(eq(schema.eventInstances.id, event.id));
    }
  });
});
