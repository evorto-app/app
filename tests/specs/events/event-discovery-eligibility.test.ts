import { userStateFile } from '../../../helpers/user-data';
import { and, eq, inArray } from 'drizzle-orm';
import type { Page } from '@playwright/test';
import type { SeedTenantResult } from '../../../helpers/seed-tenant';
import { DateTime } from 'luxon';
import { getId } from '../../../helpers/get-id';
import type { EventLocationType } from '../../../src/types/location';
import * as schema from '../../../src/db/schema';
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

const expectPublicEventDetails = async (
  page: Page,
  event: { end: Date; location: EventLocationType | null; start: Date },
  timezone: string,
): Promise<void> => {
  const details = page.getByRole('region', { name: 'Event details' });
  await expect(details).toBeVisible();
  await expect(
    details.getByText(`Times shown in ${timezone}.`, { exact: true }),
  ).toBeVisible();
  const times = details.locator('time');
  await expect(times).toHaveCount(2);
  for (const [index, value] of [event.start, event.end].entries()) {
    const date = DateTime.fromJSDate(value, { zone: timezone });
    await expect(times.nth(index)).toHaveAttribute(
      'datetime',
      value.toISOString(),
    );
    await expect(times.nth(index)).toHaveText(
      `${date.toFormat('dd.MM.yyyy')} · ${date.toFormat('HH:mm')}`,
    );
  }
  await expect(details).toContainText(event.location?.name ?? 'Not specified');
};

test.describe('Signed-in event discovery', () => {
  test.use({ storageState: userStateFile });

  test('derives visibility from any eligible registration option', async ({
    database,
    events,
    page,
    registerDatabaseCleanup,
    roles,
    seeded,
    tenant,
  }) => {
    const event = requireApprovedEvent(
      events,
      seeded.scenario.events.freeOpen.eventId,
      tenant.id,
    );
    const controlEvent = requireApprovedEvent(
      events,
      seeded.scenario.events.paidOpen.eventId,
      tenant.id,
    );
    const defaultUserRole = roles.find((role) => role.defaultUserRole);
    const organizerOnlyRole = roles.find(
      (role) => role.defaultOrganizerRole && !role.defaultUserRole,
    );
    const organizingOption = event.registrationOptions.find(
      (option) => option.organizingRegistration,
    );
    if (!defaultUserRole || !organizerOnlyRole || !organizingOption) {
      throw new Error(
        'Expected default-user, organizer-only, and organizing option fixtures',
      );
    }

    registerDatabaseCleanup(async (cleanupDatabase) => {
      await cleanupDatabase.transaction(async (transaction) => {
        for (const option of event.registrationOptions) {
          await transaction
            .update(schema.eventRegistrationOptions)
            .set({ roleIds: option.roleIds })
            .where(
              and(
                eq(schema.eventRegistrationOptions.eventId, event.id),
                eq(schema.eventRegistrationOptions.id, option.id),
              ),
            );
        }
      });
    });
    {
      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [organizerOnlyRole.id] })
        .where(
          and(
            eq(schema.eventRegistrationOptions.eventId, event.id),
            inArray(
              schema.eventRegistrationOptions.id,
              event.registrationOptions.map((option) => option.id),
            ),
          ),
        );

      await openEventList(page);
      await expect(eventCard(page, controlEvent.id)).toBeVisible({
        timeout: 15_000,
      });
      await expect(eventCard(page, event.id)).toHaveCount(0);

      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [defaultUserRole.id] })
        .where(
          and(
            eq(schema.eventRegistrationOptions.eventId, event.id),
            eq(schema.eventRegistrationOptions.id, organizingOption.id),
          ),
        );
      await page.reload();
      await expect(eventCard(page, event.id)).toBeVisible({
        timeout: 15_000,
      });

      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [] })
        .where(
          and(
            eq(schema.eventRegistrationOptions.eventId, event.id),
            eq(schema.eventRegistrationOptions.id, organizingOption.id),
          ),
        );
      await page.reload();
      await expect(eventCard(page, event.id)).toBeVisible({
        timeout: 15_000,
      });
    }
  });

  test('keeps announcement role targeting separate from ordinary options', async ({
    database,
    events,
    page,
    registerDatabaseCleanup,
    roles,
    seeded,
    tenant,
  }) => {
    const sourceEvent = requireApprovedEvent(
      events,
      seeded.scenario.events.freeOpen.eventId,
      tenant.id,
    );
    const source = await database.query.eventInstances.findFirst({
      where: { id: sourceEvent.id, tenantId: tenant.id },
    });
    const defaultUserRole = roles.find((role) => role.defaultUserRole);
    if (!source?.reviewedAt || !source.reviewedBy || !defaultUserRole) {
      throw new Error(
        'Expected approved event metadata and a default-user role',
      );
    }

    const visibleAnnouncementId = getId();
    const linkOnlyAnnouncementId = getId();
    registerDatabaseCleanup(async (cleanupDatabase) => {
      await cleanupDatabase
        .delete(schema.eventInstances)
        .where(
          and(
            eq(schema.eventInstances.tenantId, tenant.id),
            inArray(schema.eventInstances.id, [
              visibleAnnouncementId,
              linkOnlyAnnouncementId,
            ]),
          ),
        );
    });
    await database.insert(schema.eventInstances).values([
      {
        announcementRoleIds: [defaultUserRole.id],
        creatorId: source.creatorId,
        description: 'Announcement targeted to signed-in default-role members.',
        end: source.end,
        icon: source.icon,
        id: visibleAnnouncementId,
        reviewedAt: source.reviewedAt,
        reviewedBy: source.reviewedBy,
        start: source.start,
        status: 'APPROVED',
        templateId: source.templateId,
        tenantId: tenant.id,
        title: 'Default-role announcement',
      },
      {
        announcementRoleIds: [],
        creatorId: source.creatorId,
        description: 'Announcement available only from its complete link.',
        end: source.end,
        icon: source.icon,
        id: linkOnlyAnnouncementId,
        reviewedAt: source.reviewedAt,
        reviewedBy: source.reviewedBy,
        start: source.start,
        status: 'APPROVED',
        templateId: source.templateId,
        tenantId: tenant.id,
        title: 'Link-only announcement',
      },
    ]);

    await openEventList(page);
    await expect(eventCard(page, visibleAnnouncementId)).toBeVisible({
      timeout: 15_000,
    });
    await expect(eventCard(page, linkOnlyAnnouncementId)).toHaveCount(0);

    await page.goto(`/events/${linkOnlyAnnouncementId}`);
    await expect(
      page.getByRole('heading', {
        exact: true,
        level: 1,
        name: 'Link-only announcement',
      }),
    ).toBeVisible({ timeout: 15_000 });
  });
});

test.describe('Anonymous event discovery', () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    timezoneId: 'America/Los_Angeles',
  });

  test('uses default-user roles only for ordinary options and requires sign-in', async ({
    database,
    events,
    page,
    registerDatabaseCleanup,
    roles,
    seeded,
    tenant,
  }) => {
    const visibleEvent = requireApprovedEvent(
      events,
      seeded.scenario.events.freeOpen.eventId,
      tenant.id,
    );
    const hiddenEvent = requireApprovedEvent(
      events,
      seeded.scenario.events.paidOpen.eventId,
      tenant.id,
    );
    const source = await database.query.eventInstances.findFirst({
      where: { id: visibleEvent.id, tenantId: tenant.id },
    });
    const hiddenSource = await database.query.eventInstances.findFirst({
      where: { id: hiddenEvent.id, tenantId: tenant.id },
    });
    const tenantSettings = await database.query.tenants.findFirst({
      columns: { timezone: true },
      where: { id: tenant.id },
    });
    const defaultUserRole = roles.find((role) => role.defaultUserRole);
    const organizerOnlyRole = roles.find(
      (role) => role.defaultOrganizerRole && !role.defaultUserRole,
    );
    if (
      !source?.reviewedAt ||
      !source.reviewedBy ||
      !hiddenSource ||
      !tenantSettings ||
      !defaultUserRole ||
      !organizerOnlyRole
    ) {
      throw new Error(
        'Expected approved event metadata and default/non-default role fixtures',
      );
    }

    const announcementId = getId();
    registerDatabaseCleanup(async (cleanupDatabase) => {
      await cleanupDatabase.transaction(async (transaction) => {
        await transaction
          .delete(schema.eventInstances)
          .where(
            and(
              eq(schema.eventInstances.id, announcementId),
              eq(schema.eventInstances.tenantId, tenant.id),
            ),
          );
        for (const event of [visibleEvent, hiddenEvent]) {
          for (const option of event.registrationOptions) {
            await transaction
              .update(schema.eventRegistrationOptions)
              .set({ roleIds: option.roleIds })
              .where(
                and(
                  eq(schema.eventRegistrationOptions.eventId, event.id),
                  eq(schema.eventRegistrationOptions.id, option.id),
                ),
              );
          }
        }
        await transaction
          .update(schema.roles)
          .set({ defaultUserRole: defaultUserRole.defaultUserRole })
          .where(
            and(
              eq(schema.roles.id, defaultUserRole.id),
              eq(schema.roles.tenantId, tenant.id),
            ),
          );
      });
    });
    await database.transaction(async (transaction) => {
      await transaction.insert(schema.eventInstances).values({
        announcementRoleIds: [defaultUserRole.id],
        creatorId: source.creatorId,
        description:
          'A role-targeted announcement that anonymous discovery must not borrow.',
        end: source.end,
        icon: source.icon,
        id: announcementId,
        reviewedAt: source.reviewedAt,
        reviewedBy: source.reviewedBy,
        start: source.start,
        status: 'APPROVED',
        templateId: source.templateId,
        tenantId: tenant.id,
        title: 'Signed-in members announcement',
      });
      await transaction
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [defaultUserRole.id] })
        .where(
          and(
            eq(schema.eventRegistrationOptions.eventId, visibleEvent.id),
            inArray(
              schema.eventRegistrationOptions.id,
              visibleEvent.registrationOptions.map((option) => option.id),
            ),
          ),
        );
      await transaction
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [organizerOnlyRole.id] })
        .where(
          and(
            eq(schema.eventRegistrationOptions.eventId, hiddenEvent.id),
            inArray(
              schema.eventRegistrationOptions.id,
              hiddenEvent.registrationOptions.map((option) => option.id),
            ),
          ),
        );
    });
    {
      await openEventList(page);
      await expect(eventCard(page, visibleEvent.id)).toBeVisible({
        timeout: 15_000,
      });
      await expect(eventCard(page, hiddenEvent.id)).toHaveCount(0);
      await expect(eventCard(page, announcementId)).toHaveCount(0);

      await page.goto(`/events/${hiddenEvent.id}`);
      await expectPublicEventDetails(
        page,
        hiddenSource,
        tenantSettings.timezone,
      );
      await expect(
        page.getByRole('heading', {
          exact: true,
          level: 3,
          name: 'Sign in to see sign-up choices',
        }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText('Information only', { exact: true }),
      ).toHaveCount(0);
      await expect(page.locator('app-event-registration-option')).toHaveCount(
        0,
      );

      await openEventList(page);
      await eventCard(page, visibleEvent.id).click();
      await expectPublicEventDetails(page, source, tenantSettings.timezone);
      await expect(
        page.getByRole('link', { exact: true, name: 'Sign in now' }),
      ).toHaveCount(visibleEvent.registrationOptions.length);
      await expect(
        page.getByRole('link', { exact: true, name: 'Edit Event' }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('link', {
          exact: true,
          name: 'Organize this event',
        }),
      ).toHaveCount(0);

      await database.transaction(async (transaction) => {
        await transaction
          .update(schema.eventRegistrationOptions)
          .set({ roleIds: [] })
          .where(
            and(
              eq(schema.eventRegistrationOptions.eventId, visibleEvent.id),
              inArray(
                schema.eventRegistrationOptions.id,
                visibleEvent.registrationOptions.map((option) => option.id),
              ),
            ),
          );
        await transaction
          .update(schema.roles)
          .set({ defaultUserRole: false })
          .where(
            and(
              eq(schema.roles.id, defaultUserRole.id),
              eq(schema.roles.tenantId, tenant.id),
            ),
          );
      });
      await openEventList(page);
      await expect(eventCard(page, visibleEvent.id)).toHaveCount(0);
    }
  });
});

test.describe('Anonymous event route scrolling', () => {
  test.use({
    storageState: { cookies: [], origins: [] },
    viewport: { height: 500, width: 390 },
  });

  test('opens event details at the top and restores the scrolled list on Back', async ({
    database,
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
    // Keep the target below the initial viewport so click preparation cannot
    // legitimately return to the top while bringing this card into view.
    const targetStart = DateTime.fromMillis(
      Math.max(...events.map((candidate) => candidate.start.getTime())),
    )
      .plus({ days: 1 })
      .toJSDate();
    const persistedEvent = await database.query.eventInstances.findFirst({
      columns: { end: true, start: true },
      where: { id: event.id, tenantId: tenant.id },
    });
    if (!persistedEvent) {
      throw new Error('Expected the persisted scroll-restoration event');
    }
    await database
      .update(schema.eventInstances)
      .set({
        end: new Date(
          targetStart.getTime() +
            persistedEvent.end.getTime() -
            persistedEvent.start.getTime(),
        ),
        start: targetStart,
      })
      .where(
        and(
          eq(schema.eventInstances.id, event.id),
          eq(schema.eventInstances.tenantId, tenant.id),
        ),
      );
    await openEventList(page);
    const card = eventCard(page, event.id);
    await expect(card).toBeVisible();
    await expect
      .poll(() =>
        card.evaluate(
          (element) =>
            window.scrollY +
            element.getBoundingClientRect().top -
            window.innerHeight,
        ),
      )
      .toBeGreaterThan(0);
    await card.scrollIntoViewIfNeeded();
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
