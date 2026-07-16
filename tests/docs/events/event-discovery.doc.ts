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

test('Find a listed event', async ({
  database,
  page,
  registerDatabaseCleanup,
  seedDate,
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
  if (!sourceEvent) {
    throw new Error('Expected the seeded event-discovery source event');
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
  const registeredWindow = futureServerEventWindow({ startInDays: 2 });
  const otherWindow = futureServerEventWindow({ startInDays: 4 });
  const suffix = seedDate.getTime();
  const registeredTitle = `Community breakfast ${suffix}`;
  const otherTitle = `City walk ${suffix}`;

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
        ]),
      );
    await cleanupDatabase
      .delete(schema.eventInstances)
      .where(
        inArray(schema.eventInstances.id, [registeredEventId, otherEventId]),
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
        '<p>A relaxed listed event used to explain ordinary event discovery.</p>',
      end: registeredWindow.end,
      icon: sourceEvent.icon,
      id: registeredEventId,
      start: registeredWindow.start,
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: tenant.id,
      title: registeredTitle,
      unlisted: false,
    },
    {
      creatorId: participant.id,
      description:
        '<p>A second listed event used to explain compact event navigation.</p>',
      end: otherWindow.end,
      icon: sourceEvent.icon,
      id: otherEventId,
      start: otherWindow.start,
      status: 'APPROVED',
      templateId: sourceEvent.templateId,
      tenantId: tenant.id,
      title: otherTitle,
      unlisted: false,
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
      roleIds: [],
      spots: 20,
      title: 'Participant registration',
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
      title: 'Participant registration',
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
# Find a listed event

This guide explains the ordinary event list for a participant. You only need to be on the correct organization's Evorto address. You can browse listed events while signed out when their registration roles allow it, but signing in also lets Evorto mark events connected to your account.

{% callout type="note" title="Before you start" %}
Check the organization name and address before choosing an event. Each organization has its own list. Draft, past, role-ineligible, and unlisted events may be absent. An unlisted event is opened from its complete direct link instead of being found here.
{% /callout %}

## Open Events

1. Use the main navigation and select **Events**.
2. Read the date headings from top to bottom. Evorto groups upcoming cards by the event date in the organization's timezone and shows each start time on its card.
3. Read the title before selecting a card. A green outline means this signed-in account already has a non-cancelled registration, application, payment-in-progress registration, or waitlist entry for that event. It does not by itself mean payment or confirmation is complete.
`,
  });

  await page.setViewportSize({ height: 900, width: 1280 });
  await page.goto('/profile');
  const eventsNavigation = page
    .getByRole('link', { exact: true, name: 'Events' })
    .first();
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
  await expect(registeredCard).toHaveClass(/ring-success/u);
  await expect(otherCard).not.toHaveClass(/ring-success/u);
  const registeredDay = await nearestDateHeading(registeredCard);
  const otherDay = await nearestDateHeading(otherCard);
  expect(registeredDay).not.toBe('');
  expect(otherDay).not.toBe('');
  expect(registeredDay).not.toBe(otherDay);
  await takeScreenshot(
    testInfo,
    [registeredCard, otherCard],
    page,
    'Listed events grouped by date, including an account registration marker',
  );

  await testInfo.attach('markdown', {
    body: `
## Open an event on a desktop or wide screen

Select the event card. On a wide screen, the event list stays on the left while the selected event opens on the right. Review the event title and description first, then read the **Registration** section for eligibility, availability, price, and the current state of your account.
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
    'Desktop event list and selected event details',
  );

  await testInfo.attach('markdown', {
    body: `
## Open an event on a phone or compact screen

The same **Events** list is used on a compact screen. Selecting a card opens the event details at full width. Use **Back to events** at the top of the detail page to return to the list; the browser Back action works too.
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
    'Compact event details with the Back to events action',
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

**No events found** is a successful empty result, not a loading failure. It means Evorto found no upcoming, listed event that this account may see for this organization. Check that you used the intended organization's Evorto address. The event may also be in the past, unlisted, still a draft, or restricted to another role. Ask an organizer for the complete direct link when they intentionally made an event unlisted.
`,
  });
  await takeScreenshot(
    testInfo,
    emptyState,
    page,
    'Successful empty event list',
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
    'Event discovery is temporarily unavailable. Check your connection and try again.',
  );
  await expect(
    errorState.getByRole('button', { name: 'Try again' }),
  ).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
## If the list fails to load

**Events could not be loaded** is different from **No events found**: Evorto could not load the event list, so do not assume there are no events. Check the connection and select **Try again**. If the error continues, report the displayed message and organization address to an administrator.
`,
  });
  await takeScreenshot(
    testInfo,
    errorState,
    page,
    'Event list request failure shown separately from an empty result',
  );
  await page.unroute(rpcUrlPattern, failEventListRequests);
  await page.reload();
  await expect(eventCard(page, registeredEventId)).toBeVisible({
    timeout: 20_000,
  });
  await expect(errorState).toHaveCount(0);
});
