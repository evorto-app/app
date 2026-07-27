import { userStateFile } from '../../../helpers/user-data';
import { eq, inArray } from 'drizzle-orm';
import type { Page } from '@playwright/test';
import { getId } from '../../../helpers/get-id';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

interface DiscoveryEvent {
  id: string;
  registrationOptions: {
    id: string;
    organizingRegistration: boolean;
    roleIds: string[];
  }[];
  status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW';
  title: string;
}

const requireApprovedEvent = (
  events: DiscoveryEvent[],
  eventId: string,
): DiscoveryEvent => {
  const event = events.find((candidate) => candidate.id === eventId);
  if (!event || event.status !== 'APPROVED') {
    throw new Error(
      `Expected seeded scenario event "${eventId}" to be approved`,
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

test.describe('Signed-in event discovery', () => {
  test.use({ storageState: userStateFile });

  test('derives visibility from any eligible registration option', async ({
    database,
    events,
    page,
    roles,
    seeded,
  }) => {
    const event = requireApprovedEvent(
      events,
      seeded.scenario.events.freeOpen.eventId,
    );
    const controlEvent = requireApprovedEvent(
      events,
      seeded.scenario.events.paidOpen.eventId,
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

    try {
      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [organizerOnlyRole.id] })
        .where(
          inArray(
            schema.eventRegistrationOptions.id,
            event.registrationOptions.map((option) => option.id),
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
        .where(eq(schema.eventRegistrationOptions.id, organizingOption.id));
      await page.reload();
      await expect(eventCard(page, event.id)).toBeVisible({
        timeout: 15_000,
      });

      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [] })
        .where(eq(schema.eventRegistrationOptions.id, organizingOption.id));
      await page.reload();
      await expect(eventCard(page, event.id)).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      for (const option of event.registrationOptions) {
        await database
          .update(schema.eventRegistrationOptions)
          .set({ roleIds: option.roleIds })
          .where(eq(schema.eventRegistrationOptions.id, option.id));
      }
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
          inArray(schema.eventInstances.id, [
            visibleAnnouncementId,
            linkOnlyAnnouncementId,
          ]),
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
  test.use({ storageState: { cookies: [], origins: [] } });

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
    );
    const hiddenEvent = requireApprovedEvent(
      events,
      seeded.scenario.events.paidOpen.eventId,
    );
    const source = await database.query.eventInstances.findFirst({
      where: { id: visibleEvent.id, tenantId: tenant.id },
    });
    const defaultUserRole = roles.find((role) => role.defaultUserRole);
    const organizerOnlyRole = roles.find(
      (role) => role.defaultOrganizerRole && !role.defaultUserRole,
    );
    if (
      !source?.reviewedAt ||
      !source.reviewedBy ||
      !defaultUserRole ||
      !organizerOnlyRole
    ) {
      throw new Error(
        'Expected approved event metadata and default/non-default role fixtures',
      );
    }

    const announcementId = getId();
    registerDatabaseCleanup(async (cleanupDatabase) => {
      await cleanupDatabase
        .delete(schema.eventInstances)
        .where(eq(schema.eventInstances.id, announcementId));
    });
    await database.insert(schema.eventInstances).values({
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

    try {
      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [defaultUserRole.id] })
        .where(
          inArray(
            schema.eventRegistrationOptions.id,
            visibleEvent.registrationOptions.map((option) => option.id),
          ),
        );
      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [organizerOnlyRole.id] })
        .where(
          inArray(
            schema.eventRegistrationOptions.id,
            hiddenEvent.registrationOptions.map((option) => option.id),
          ),
        );

      await openEventList(page);
      await expect(eventCard(page, visibleEvent.id)).toBeVisible({
        timeout: 15_000,
      });
      await expect(eventCard(page, hiddenEvent.id)).toHaveCount(0);
      await expect(eventCard(page, announcementId)).toHaveCount(0);

      await page.goto(`/events/${hiddenEvent.id}`);
      await expect(
        page.getByRole('heading', {
          exact: true,
          level: 3,
          name: 'Sign in to check registration',
        }),
      ).toBeVisible({ timeout: 15_000 });
      await expect(
        page.getByText('No registration options', { exact: true }),
      ).toHaveCount(0);
      await expect(page.locator('app-event-registration-option')).toHaveCount(
        0,
      );

      await openEventList(page);
      await eventCard(page, visibleEvent.id).click();
      await expect(
        page.getByRole('link', { exact: true, name: 'Log in now' }),
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

      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [] })
        .where(
          inArray(
            schema.eventRegistrationOptions.id,
            visibleEvent.registrationOptions.map((option) => option.id),
          ),
        );
      await database
        .update(schema.roles)
        .set({ defaultUserRole: false })
        .where(eq(schema.roles.id, defaultUserRole.id));
      await openEventList(page);
      await expect(eventCard(page, visibleEvent.id)).toHaveCount(0);
    } finally {
      await database
        .update(schema.roles)
        .set({ defaultUserRole: defaultUserRole.defaultUserRole })
        .where(eq(schema.roles.id, defaultUserRole.id));
      for (const event of [visibleEvent, hiddenEvent]) {
        for (const option of event.registrationOptions) {
          await database
            .update(schema.eventRegistrationOptions)
            .set({ roleIds: option.roleIds })
            .where(eq(schema.eventRegistrationOptions.id, option.id));
        }
      }
    }
  });
});
