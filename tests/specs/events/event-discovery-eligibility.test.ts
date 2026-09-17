import type { Page } from '@playwright/test';
import type { SeedTenantResult } from '../../../helpers/seed-tenant';

import { expect, test } from '../../support/fixtures/parallel-test';

type DiscoveryEvent = SeedTenantResult['events'][number];

const requireApprovedEvent = (
  events: DiscoveryEvent[],
  eventId: string,
  tenantId: string,
): DiscoveryEvent => {
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event || event.status !== 'APPROVED' || event.tenantId !== tenantId) {
    throw new Error(
      `Expected seeded scenario event "${eventId}" to be approved in tenant "${tenantId}"`,
    );
  }
  if (event.registrationOptions.length === 0) {
    throw new Error(
      `Expected seeded scenario event "${eventId}" to have registration options`,
    );
  }
  return event;
};

const eventCard = (page: Page, eventId: string) =>
  page.locator(`app-event-list nav a[href="/events/${eventId}"]`);

const openEventList = async (page: Page): Promise<void> => {
  await page.goto('/events');
  await expect(
    page.getByRole('heading', { exact: true, level: 1, name: 'Events' }),
  ).toBeVisible({ timeout: 15_000 });
};

test.describe('Anonymous event route scrolling', () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    viewport: { height: 600, width: 390 },
  });

  test('opens event details at the top and restores the scrolled list on Back', async ({
    events,
    page,
    seeded,
    tenant,
  }, testInfo) => {
    const event = requireApprovedEvent(
      events,
      seeded.scenario.events.paidOpen.eventId,
      tenant.id,
    );
    await openEventList(page);
    const card = eventCard(page, event.id);
    await expect(card).toBeVisible();
    await card.evaluate((element) => {
      const cardTop = window.scrollY + element.getBoundingClientRect().top;
      window.scrollTo({
        behavior: 'instant',
        top: Math.max(48, cardTop - 150),
      });
    });
    await expect(card).toBeInViewport({ ratio: 1 });
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(0);
    const departureMeasurement = await card.evaluateHandle((element) => {
      const measure = () => ({
        cardTop: element.getBoundingClientRect().top,
        documentHeight: document.documentElement.scrollHeight,
        fontStatus: document.fonts.status,
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
      });
      const measurement: {
        beforeClick: ReturnType<typeof measure>;
        departure: null | ReturnType<typeof measure>;
      } = { beforeClick: measure(), departure: null };
      // Capture after Playwright's click preparation, before RouterLink starts
      // the navigation whose position Angular restores on browser Back.
      element.addEventListener(
        'click',
        () => {
          measurement.departure = measure();
        },
        { capture: true, once: true },
      );
      return measurement;
    });
    const departureErrors: unknown[] = [];
    let measurement:
      Awaited<ReturnType<typeof departureMeasurement.jsonValue>> | undefined;
    try {
      await card.click();
      measurement = await departureMeasurement.jsonValue();
    } catch (error) {
      departureErrors.push(error);
    }
    try {
      await departureMeasurement.dispose();
    } catch (error) {
      departureErrors.push(error);
    }
    if (departureErrors.length > 0) {
      throw new AggregateError(
        departureErrors,
        'Event list departure measurement or cleanup failed',
      );
    }
    if (!measurement?.departure) {
      throw new Error(
        'Expected the event card to capture its navigation click',
      );
    }
    const listScrollPosition = measurement.departure.scrollY;
    await testInfo.attach('event-list-scroll-departure', {
      body: JSON.stringify(measurement),
      contentType: 'application/json',
    });
    expect(listScrollPosition).toBeGreaterThan(0);
    await expect(page).toHaveURL(`/events/${event.id}`);
    const heading = page.getByRole('heading', {
      exact: true,
      level: 1,
      name: event.title,
    });
    await expect(heading).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect(heading).toBeInViewport({ ratio: 1 });

    await page.goBack();
    await expect(page).toHaveURL('/events');
    await expect(
      page.getByRole('heading', { exact: true, level: 1, name: 'Events' }),
    ).toBeVisible();
    const restorationErrors: unknown[] = [];
    try {
      await expect
        .poll(async () =>
          Math.abs(
            (await page.evaluate(() => window.scrollY)) - listScrollPosition,
          ),
        )
        .toBeLessThan(2);
    } catch (error) {
      restorationErrors.push(error);
    }
    try {
      await testInfo.attach('event-list-scroll-restoration', {
        body: JSON.stringify(
          await page.evaluate((eventId) => {
            const element = document.querySelector(
              `app-event-list nav a[href="/events/${eventId}"]`,
            );
            return {
              cardTop: element?.getBoundingClientRect().top ?? null,
              documentHeight: document.documentElement.scrollHeight,
              fontStatus: document.fonts.status,
              scrollY: window.scrollY,
              viewportHeight: window.innerHeight,
            };
          }, event.id),
        ),
        contentType: 'application/json',
      });
    } catch (error) {
      restorationErrors.push(error);
    }
    if (restorationErrors.length > 0) {
      throw new AggregateError(
        restorationErrors,
        'Event list scroll restoration or diagnostic attachment failed',
      );
    }
    await expect(card).toBeInViewport({ ratio: 1 });
  });
});
