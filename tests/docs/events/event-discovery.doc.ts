import type { Locator, Page, Route } from '@playwright/test';

import { eq, inArray } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import { userStateFile, usersToAuthenticate } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { waitForRegistrationPage } from '../../support/utils/event-registration-page';
import { futureServerEventWindow } from '../../support/utils/server-test-clock';

test.use({ storageState: userStateFile });
test.setTimeout(180_000);

const eventCard = (page: Page, eventId: string): Locator =>
  page.locator(`app-event-list nav a[href="/events/${eventId}"]`);

const rpcUrlPattern = /\/rpc\/?(?:\?.*)?$/u;

const navigateClientSide = async (page: Page, path: string): Promise<void> => {
  await page.evaluate((nextPath) => {
    window.history.pushState({}, '', nextPath);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
  await expect(page).toHaveURL(path);
};

const nearestDateHeading = async (card: Locator): Promise<string> =>
  card.evaluate((element) => {
    let sibling = element.previousElementSibling;
    while (sibling) {
      if (sibling.matches('p.title-medium')) {
        return sibling.textContent?.trim() ?? '';
      }
      sibling = sibling.previousElementSibling;
    }
    return '';
  });

test('Find an event you can join', async ({
  database,
  page,
  registerDatabaseCleanup,
  roles,
  seeded,
  tenant,
}, testInfo) => {
  const participant = usersToAuthenticate.find((user) => user.roles === 'user');
  if (!participant) {
    throw new Error('Expected the regular participant fixture');
  }

  const sourceEvent = await database.query.eventInstances.findFirst({
    where: {
      id: seeded.scenario.events.freeOpen.eventId,
      tenantId: tenant.id,
    },
  });
  if (!sourceEvent?.reviewedAt || !sourceEvent.reviewedBy) {
    throw new Error(
      'Expected the approved event-discovery source event with review metadata',
    );
  }

  const originalEventTimes = await database.query.eventInstances.findMany({
    columns: { end: true, id: true, start: true },
    where: { tenantId: tenant.id },
  });
  const registeredEventId = getId();
  const registeredOptionId = getId();
  const registeredRegistrationId = getId();
  const otherEventId = getId();
  const otherOptionId = getId();
  const ineligibleEventId = getId();
  const ineligibleOptionId = getId();
  const registeredWindow = futureServerEventWindow({ startInDays: 2 });
  const otherWindow = futureServerEventWindow({ startInDays: 4 });
  const ineligibleWindow = futureServerEventWindow({ startInDays: 6 });
  const registeredTitle = 'Community breakfast';
  const otherTitle = 'City walk';
  const ineligibleTitle = 'Organizer planning session';
  const defaultUserRole = roles.find((role) => role.defaultUserRole);
  const organizerOnlyRole = roles.find(
    (role) => role.defaultOrganizerRole && !role.defaultUserRole,
  );
  if (!defaultUserRole || !organizerOnlyRole) {
    throw new Error(
      'Expected default-user and organizer-only roles for event discovery docs',
    );
  }

  registerDatabaseCleanup(async (cleanupDatabase) => {
    await cleanupDatabase
      .delete(schema.eventRegistrations)
      .where(eq(schema.eventRegistrations.id, registeredRegistrationId));
    await cleanupDatabase
      .delete(schema.eventRegistrationOptions)
      .where(
        inArray(schema.eventRegistrationOptions.id, [
          registeredOptionId,
          otherOptionId,
          ineligibleOptionId,
        ]),
      );
    await cleanupDatabase
      .delete(schema.eventInstances)
      .where(
        inArray(schema.eventInstances.id, [
          registeredEventId,
          otherEventId,
          ineligibleEventId,
        ]),
      );

    for (const event of originalEventTimes) {
      await cleanupDatabase
        .update(schema.eventInstances)
        .set({ end: event.end, start: event.start })
        .where(eq(schema.eventInstances.id, event.id));
    }
  });

  await database.insert(schema.eventInstances).values([
    {
      creatorId: participant.id,
      description:
        '<p>A relaxed afternoon event with places available for members.</p>',
      end: registeredWindow.end,
      icon: sourceEvent.icon,
      id: registeredEventId,
      reviewedAt: sourceEvent.reviewedAt,
      reviewedBy: sourceEvent.reviewedBy,
      start: registeredWindow.start,
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: tenant.id,
      title: registeredTitle,
    },
    {
      creatorId: participant.id,
      description: '<p>A small-group event with clear meeting details.</p>',
      end: otherWindow.end,
      icon: sourceEvent.icon,
      id: otherEventId,
      reviewedAt: sourceEvent.reviewedAt,
      reviewedBy: sourceEvent.reviewedBy,
      start: otherWindow.start,
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: tenant.id,
      title: otherTitle,
    },
    {
      creatorId: participant.id,
      description: '<p>A planning session for a different member group.</p>',
      end: ineligibleWindow.end,
      icon: sourceEvent.icon,
      id: ineligibleEventId,
      reviewedAt: sourceEvent.reviewedAt,
      reviewedBy: sourceEvent.reviewedBy,
      start: ineligibleWindow.start,
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: tenant.id,
      title: ineligibleTitle,
    },
  ]);
  await database.insert(schema.eventRegistrationOptions).values([
    {
      closeRegistrationTime: registeredWindow.closeRegistrationTime,
      eventId: registeredEventId,
      id: registeredOptionId,
      isPaid: false,
      openRegistrationTime: registeredWindow.openRegistrationTime,
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      roleIds: [defaultUserRole.id],
      spots: 20,
      title: 'Attendee sign-up',
      waitlistSpots: 1,
    },
    {
      closeRegistrationTime: otherWindow.closeRegistrationTime,
      eventId: otherEventId,
      id: otherOptionId,
      isPaid: false,
      openRegistrationTime: otherWindow.openRegistrationTime,
      organizingRegistration: false,
      price: 0,
      registrationMode: 'fcfs',
      roleIds: [],
      spots: 20,
      title: 'Attendee sign-up',
    },
    {
      closeRegistrationTime: ineligibleWindow.closeRegistrationTime,
      eventId: ineligibleEventId,
      id: ineligibleOptionId,
      isPaid: false,
      openRegistrationTime: ineligibleWindow.openRegistrationTime,
      organizingRegistration: true,
      price: 0,
      registrationMode: 'fcfs',
      roleIds: [organizerOnlyRole.id],
      spots: 10,
      title: 'Organizer planning',
    },
  ]);
  await database.insert(schema.eventRegistrations).values({
    eventId: registeredEventId,
    id: registeredRegistrationId,
    registrationOptionId: registeredOptionId,
    status: 'WAITLIST',
    tenantId: tenant.id,
    userId: participant.id,
  });

  await testInfo.attach('markdown', {
    body: `

Open the correct organization's Evorto address to see its events. After signing in, a sign-up event appears when it has at least one choice available to you, whether you want to attend, help organize, or join in another way defined by the organization.

{% callout type="note" title="Before you start" %}
Check the organization name and address before choosing an event. Each organization has its own list. Events that are not yet published, have ended, or are not open to you do not appear. A shared link still opens a published event and explains when you cannot sign up. Announcements follow a different rule: they appear to members with roles selected on the announcement. Without a selected role, an announcement can be opened only through a shared link. This choice does not change anyone's role or send a message.
{% /callout %}

## Open Events

1. Use the main navigation and select **Events**.
2. Read the date headings from top to bottom. Evorto groups upcoming cards by the event date in the organization's time zone and shows each start time on its card.
3. Read the title and sign-up status before selecting a card. **Place confirmed**, **Waiting for approval**, **Finish payment**, and **On waitlist** show exactly where you stand. Open the event when you need details or an action.
`,
  });

  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/profile');
  const eventsNavigation = page
    .getByRole('navigation', { name: 'Main navigation' })
    .getByRole('link', { exact: true, name: 'Events' });
  await expect(eventsNavigation).toBeVisible();
  await eventsNavigation.click();
  await expect(page).toHaveURL('/events');
  await expect(
    page.getByRole('heading', { exact: true, level: 1, name: 'Events' }),
  ).toBeVisible({ timeout: 20_000 });

  let registeredCard = eventCard(page, registeredEventId);
  let otherCard = eventCard(page, otherEventId);
  await expect(registeredCard).toBeVisible({ timeout: 20_000 });
  await expect(otherCard).toBeVisible({ timeout: 20_000 });
  await expect(eventCard(page, ineligibleEventId)).toHaveCount(0);
  await expect(registeredCard).toHaveClass(/ring-primary/u);
  await expect(
    registeredCard.getByText('On waitlist', { exact: true }),
  ).toBeVisible();
  await expect(otherCard).not.toHaveClass(/ring-primary/u);
  const registeredDay = await nearestDateHeading(registeredCard);
  const otherDay = await nearestDateHeading(otherCard);
  expect(registeredDay).not.toBe('');
  expect(otherDay).not.toBe('');
  expect(registeredDay).not.toBe(otherDay);
  await takeScreenshot(
    testInfo,
    [registeredCard, otherCard],
    page,
    'Available events grouped by date, including a waitlist place',
  );

  await testInfo.attach('markdown', {
    body: `
## Open an event from the list

Select the event card. When there is enough space, the event list stays on the left while the selected event opens on the right. Review the title and description first, then read **Your sign-up** to see who can sign up, remaining places, the price, and what you need to do.
`,
  });
  await registeredCard.click();
  await expect(page).toHaveURL(`/events/${registeredEventId}`);
  await expect(
    page.getByRole('heading', {
      exact: true,
      level: 1,
      name: registeredTitle,
    }),
  ).toBeVisible({ timeout: 20_000 });
  await waitForRegistrationPage(page);
  registeredCard = eventCard(page, registeredEventId);
  await expect(registeredCard).toBeVisible();
  await expect(
    page.getByRole('link', { exact: true, name: 'Back to events' }),
  ).toBeHidden();
  await takeScreenshot(
    testInfo,
    page.locator('app-event-list'),
    page,
    'Event list beside the selected event details',
  );

  await testInfo.attach('markdown', {
    body: `
## Open an event on a small screen

The same **Events** list is used on a small screen. Selecting a card opens the event details across the available space. Use **Back to events** at the top of the detail page to return to the list.
`,
  });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto('/events');
  otherCard = eventCard(page, otherEventId);
  await expect(otherCard).toBeVisible({ timeout: 20_000 });
  await otherCard.click();
  await expect(page).toHaveURL(`/events/${otherEventId}`);
  await expect(
    page.getByRole('heading', { exact: true, level: 1, name: otherTitle }),
  ).toBeVisible({ timeout: 20_000 });
  await waitForRegistrationPage(page);
  const backToEvents = page.getByRole('link', {
    exact: true,
    name: 'Back to events',
  });
  await expect(backToEvents).toBeVisible();
  await expect(eventCard(page, otherEventId)).toBeHidden();
  await takeScreenshot(
    testInfo,
    page.locator('app-event-list'),
    page,
    'Selected event with the Back to events action',
  );
  await backToEvents.click();
  await expect(page).toHaveURL('/events');
  await expect(eventCard(page, otherEventId)).toBeVisible({ timeout: 20_000 });

  await database
    .update(schema.eventInstances)
    .set({
      end: new Date('2000-01-01T02:00:00.000Z'),
      start: new Date('2000-01-01T00:00:00.000Z'),
    })
    .where(eq(schema.eventInstances.tenantId, tenant.id));
  await page.setViewportSize({ height: 900, width: 1280 });
  await page.reload();
  const emptyState = page.getByText('No events found', { exact: true });
  await expect(emptyState).toBeVisible({ timeout: 20_000 });
  await testInfo.attach('markdown', {
    body: `
## If the list is empty

**No events found** means there are currently no upcoming events available to you and no announcements selected for one of your organization roles. Check that you opened the intended organization's Evorto address. An event may also have ended, still be waiting for publication, or be open to another role. Ask an organizer for the full shared link when an announcement is shared by link only.
`,
  });
  await takeScreenshot(
    testInfo,
    emptyState,
    page,
    'No upcoming events are currently available',
  );

  for (const event of originalEventTimes) {
    await database
      .update(schema.eventInstances)
      .set({ end: event.end, start: event.start })
      .where(eq(schema.eventInstances.id, event.id));
  }
  await database
    .update(schema.eventInstances)
    .set({ end: registeredWindow.end, start: registeredWindow.start })
    .where(eq(schema.eventInstances.id, registeredEventId));
  await database
    .update(schema.eventInstances)
    .set({ end: otherWindow.end, start: otherWindow.start })
    .where(eq(schema.eventInstances.id, otherEventId));
  await database
    .update(schema.eventInstances)
    .set({ end: ineligibleWindow.end, start: ineligibleWindow.start })
    .where(eq(schema.eventInstances.id, ineligibleEventId));

  await page.goto('/profile', { waitUntil: 'networkidle' });
  await expect(page.locator('[ngh]')).toHaveCount(0, { timeout: 20_000 });
  let eventListFailureCount = 0;
  const failEventListRequests = async (route: Route): Promise<void> => {
    const request = route.request();
    const rpcPath = new URL(request.url()).pathname.replace(/\/+$/u, '');
    if (
      rpcPath === '/rpc' &&
      request.method() === 'POST' &&
      (request.postData() ?? '').includes('events.eventList')
    ) {
      eventListFailureCount += 1;
      await route.abort('failed');
      return;
    }
    await route.fallback();
  };
  await page.route(rpcUrlPattern, failEventListRequests);
  // A document navigation resolves the list during SSR, outside page routing.
  await navigateClientSide(page, '/events');
  await expect
    .poll(() => eventListFailureCount, { timeout: 20_000 })
    .toBeGreaterThan(0);
  const errorState = page.locator('app-event-list nav').getByRole('alert');
  await expect(errorState).toBeVisible({ timeout: 20_000 });
  await expect(
    errorState.getByRole('heading', { name: 'Events could not be loaded' }),
  ).toBeVisible();
  await expect(errorState).toContainText(
    'No events are shown. Select Try again.',
  );
  await expect(
    errorState.getByRole('button', { name: 'Try again' }),
  ).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
## If the list fails to load

**Events could not be loaded** is different from **No events found**: Evorto could not load the event list, so do not assume there are no events. Select **Try again** once. If the warning remains, contact Evorto support.
`,
  });
  await takeScreenshot(
    testInfo,
    errorState,
    page,
    'Event list could not be loaded',
  );
  await page.unroute(rpcUrlPattern, failEventListRequests);
  await page.reload();
  await expect(eventCard(page, registeredEventId)).toBeVisible({
    timeout: 20_000,
  });
  await expect(errorState).toHaveCount(0);

  const tenantCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'evorto-tenant',
  );
  if (!tenantCookie) {
    throw new Error('Expected the isolated tenant routing cookie');
  }
  await page.context().clearCookies();
  await page.context().addCookies([tenantCookie]);
  await page.goto('/events');
  await expect(eventCard(page, registeredEventId)).toBeVisible({
    timeout: 20_000,
  });
  await expect(eventCard(page, otherEventId)).toBeVisible({
    timeout: 20_000,
  });
  await expect(eventCard(page, ineligibleEventId)).toHaveCount(0);

  await testInfo.attach('markdown', {
    body: `
## Browse before signing in

Before signing in, visitors may see published events that are open to new members. The page shows only public event details and asks the visitor to sign in before signing up. A shared link to another published event still opens its public details, while sign-up choices remain hidden until the visitor signs in. Announcements do not appear before sign-in, but their public details still open from a shared link.
`,
  });
  await page.goto(`/events/${ineligibleEventId}`);
  await expect(
    page.getByRole('heading', {
      exact: true,
      level: 1,
      name: ineligibleTitle,
    }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole('heading', {
      exact: true,
      level: 3,
      name: 'Sign in to see sign-up choices',
    }),
  ).toBeVisible();
  await expect(
    page.getByText('No sign-up choices', { exact: true }),
  ).toHaveCount(0);
  await expect(page.locator('app-event-registration-option')).toHaveCount(0);

  await page.goto('/events');
  await eventCard(page, registeredEventId).click();
  await waitForRegistrationPage(page);
  const signInAction = page.getByRole('link', {
    exact: true,
    name: 'Sign in now',
  });
  await expect(signInAction).toBeVisible();
  await expect(
    page.getByRole('link', { exact: true, name: 'Edit Event' }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('link', { exact: true, name: 'Organize this event' }),
  ).toHaveCount(0);
  await takeScreenshot(
    testInfo,
    page.locator('section').filter({ hasText: 'Your sign-up' }),
    page,
    'Public event preview requires sign-in before sign-up',
  );
});
