import { and, eq } from 'drizzle-orm';
import type { Locator, Page } from '@playwright/test';

import { userStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: userStateFile });

interface EventListFixtureRecord {
  id: string;
  start: Date;
  status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED';
  title: string;
  unlisted: boolean;
}

const findUpcomingApprovedListedEvents = (
  events: EventListFixtureRecord[],
  listClock: Date,
) =>
  events
    .filter(
      (event) =>
        event.status === 'APPROVED' &&
        !event.unlisted &&
        event.start.getTime() > listClock.getTime(),
    )
    .toSorted((left, right) => left.start.getTime() - right.start.getTime());

const eventRegistrationSection = (page: Page): Locator =>
  page
    .locator('section')
    .filter({
      has: page.getByRole('heading', { level: 2, name: 'Registration' }),
    })
    .first();

const eventRegistrationOptionSurface = (
  page: Page,
  input: { optionTitle: string },
): Locator =>
  eventRegistrationSection(page)
    .locator('app-event-registration-option')
    .filter({
      has: page.getByRole('heading', { name: input.optionTitle }),
    })
    .filter({ hasText: 'Participant option' })
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
  seedDate,
}, testInfo) => {
  const [event, listedContextEvent] = findUpcomingApprovedListedEvents(
    events,
    seedDate,
  );
  if (!event) {
    throw new Error(
      'Expected an upcoming approved listed event in the seeded events',
    );
  }
  if (!listedContextEvent) {
    throw new Error(
      'Expected a second upcoming approved listed event for unlisted docs list context',
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
    const [participantRegistrationOption] = await database
      .select({
        title: schema.eventRegistrationOptions.title,
      })
      .from(schema.eventRegistrationOptions)
      .where(
        and(
          eq(schema.eventRegistrationOptions.eventId, event.id),
          eq(schema.eventRegistrationOptions.organizingRegistration, false),
        ),
      )
      .limit(1);
    if (!participantRegistrationOption) {
      throw new Error(
        `Expected unlisted docs event "${event.title}" to have a visible participant registration option`,
      );
    }
    const registrationOption = eventRegistrationOptionSurface(page, {
      optionTitle: participantRegistrationOption.title,
    });
    await expect(registrationOption).toBeVisible();
    await takeScreenshot(
      testInfo,
      registrationOption,
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
