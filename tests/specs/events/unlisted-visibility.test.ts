import { adminStateFile, userStateFile } from '../../../helpers/user-data';
import { eq } from 'drizzle-orm';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

const findApprovedListedEvent = (
  events: {
    id: string;
    start: Date;
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
    title: string;
    unlisted: boolean;
  }[],
  visibleAfter: Date,
) =>
  events.find(
    (event) =>
      event.status === 'APPROVED' &&
      !event.unlisted &&
      event.start > visibleAfter,
  );

const requireApprovedListedEvent = (
  events: Parameters<typeof findApprovedListedEvent>[0],
  visibleAfter: Date,
) => {
  const listed = findApprovedListedEvent(events, visibleAfter);
  if (!listed) {
    throw new Error(
      'Expected an approved listed event after the list start filter',
    );
  }
  return listed;
};

test.describe('Unlisted events visibility', () => {
  test.use({ storageState: userStateFile });

  test('regular user does not see unlisted in list', async ({
    database,
    events,
    page,
    testClock,
  }) => {
    const event = requireApprovedListedEvent(events, testClock.toJSDate());

    try {
      await database
        .update(schema.eventInstances)
        .set({ unlisted: true })
        .where(eq(schema.eventInstances.id, event.id));

      await page.goto('/events');
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
    testClock,
  }) => {
    const event = requireApprovedListedEvent(events, testClock.toJSDate());

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
    testClock,
  }) => {
    const event = requireApprovedListedEvent(events, testClock.toJSDate());

    try {
      await database
        .update(schema.eventInstances)
        .set({ unlisted: true })
        .where(eq(schema.eventInstances.id, event.id));

      await page.goto('/events');
      const eventCard = page.locator(`a[href="/events/${event.id}"]`);
      await expect(eventCard).toBeVisible();
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
