import { eq } from 'drizzle-orm';
import type { Locator, Page } from '@playwright/test';

import { userStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: userStateFile });

const findApprovedListedEvent = (
  events: {
    id: string;
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
    title: string;
    unlisted: boolean;
  }[],
) => events.find((event) => event.status === 'APPROVED' && !event.unlisted);

const findDifferentApprovedListedEvent = (
  events: {
    id: string;
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
    title: string;
    unlisted: boolean;
  }[],
  hiddenEventId: string,
) =>
  events.find(
    (event) =>
      event.id !== hiddenEventId &&
      event.status === 'APPROVED' &&
      !event.unlisted,
  );

const eventRegistrationSection = (page: Page): Locator =>
  page
    .locator('section')
    .filter({
      has: page.getByRole('heading', { level: 2, name: 'Registration' }),
    })
    .first();

const visibleListedEventLink = (page: Page, eventTitle: string): Locator =>
  page
    .locator('app-event-list nav a')
    .filter({
      has: page.getByRole('heading', { level: 2, name: eventTitle }),
    })
    .first();

test('User: understanding unlisted events', async ({
  database,
  events,
  page,
}, testInfo) => {
  const event = findApprovedListedEvent(events);
  if (!event) {
    throw new Error('Expected an approved listed event in the seeded events');
  }
  const listedContextEvent = findDifferentApprovedListedEvent(events, event.id);
  if (!listedContextEvent) {
    throw new Error(
      'Expected a second approved listed event for unlisted docs list context',
    );
  }

  try {
    await database
      .update(schema.eventInstances)
      .set({ unlisted: true })
      .where(eq(schema.eventInstances.id, event.id));

    await page.goto('./events');

    await testInfo.attach('markdown', {
      body: `
# Unlisted Events (User)

Some events are marked as "unlisted" by organizers. These events do not appear in public event lists. If you receive a direct link (and have access to the registration options), you can still open the event page.

What this means for you:

- Event list shows only visible, approved events
- Unlisted events are hidden from the list
- A direct link to an unlisted event will still work when shared with you
`,
    });

    await expect(page.getByRole('link', { name: event.title })).toHaveCount(0);
    const visibleListedEvent = visibleListedEventLink(
      page,
      listedContextEvent.title,
    );
    await expect(visibleListedEvent).toBeVisible();
    await takeScreenshot(
      testInfo,
      visibleListedEvent,
      page,
      'Visible listed event card while the unlisted event is hidden from the event list',
    );

    await page.goto(`/events/${event.id}`);
    await expect(
      page.getByRole('heading', { name: event.title }),
    ).toBeVisible();
    const registrationSection = eventRegistrationSection(page);
    await expect(registrationSection).toBeVisible();
    await expect(
      registrationSection.locator('app-event-registration-option').first(),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      registrationSection,
      page,
      'Direct link opens the unlisted event registration details',
    );

    await testInfo.attach('markdown', {
      body: `
If an event is shared with you directly, open the link you were given to access the event details and register (if registration options are available to your account).
`,
    });
  } finally {
    await database
      .update(schema.eventInstances)
      .set({ unlisted: event.unlisted })
      .where(eq(schema.eventInstances.id, event.id));
  }
});
