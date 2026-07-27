import { adminStateFile, userStateFile } from '../../../helpers/user-data';
import { eq } from 'drizzle-orm';
import type { Page } from '@playwright/test';
import * as schema from '../../../src/db/schema';
import type { EventListingAudience } from '../../../src/shared/event-listing-audience';
import { expect, test } from '../../support/fixtures/parallel-test';

const requireApprovedListedEvent = (
  events: {
    id: string;
    listingAudience: EventListingAudience;
    registrationOptions: {
      id: string;
      organizingRegistration: boolean;
      roleIds: string[];
    }[];
    start: Date;
    status: 'APPROVED' | 'DRAFT' | 'PENDING_REVIEW';
    title: string;
  }[],
  eventId: string,
) => {
  const event = events.find((candidate) => candidate.id === eventId);
  if (
    !event ||
    event.status !== 'APPROVED' ||
    event.listingAudience === 'unlisted'
  ) {
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

test.describe('Event listing audience visibility', () => {
  test.use({ storageState: userStateFile });

  test('regular discovery enforces every listing audience', async ({
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
    const participantOption = event.registrationOptions.find(
      (option) => !option.organizingRegistration,
    );
    const organizerOption = event.registrationOptions.find(
      (option) => option.organizingRegistration,
    );
    if (!participantOption || !organizerOption) {
      throw new Error(
        'Expected participant and organizer options for listing audience coverage',
      );
    }

    const expectAudienceVisibility = async (
      listingAudience: EventListingAudience,
      visible: boolean,
    ) => {
      await database
        .update(schema.eventInstances)
        .set({ listingAudience })
        .where(eq(schema.eventInstances.id, event.id));
      await page.goto('/events');
      await waitForEventCard(page, controlEvent.id);
      const eventLink = page.getByRole('link', { name: event.title });
      if (visible) {
        await expect(eventLink).toBeVisible();
      } else {
        await expect(eventLink).toHaveCount(0);
      }
    };

    try {
      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: [] })
        .where(eq(schema.eventRegistrationOptions.id, participantOption.id));
      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: ['listing-ineligible'] })
        .where(eq(schema.eventRegistrationOptions.id, organizerOption.id));

      await expectAudienceVisibility('participant', true);
      await expectAudienceVisibility('organizer', false);
      await expectAudienceVisibility('both', true);
      await expectAudienceVisibility('unlisted', false);
      await expect(
        page.locator('app-event-list nav').getByText('Unlisted', {
          exact: true,
        }),
      ).toHaveCount(0);
    } finally {
      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: participantOption.roleIds })
        .where(eq(schema.eventRegistrationOptions.id, participantOption.id));
      await database
        .update(schema.eventRegistrationOptions)
        .set({ roleIds: organizerOption.roleIds })
        .where(eq(schema.eventRegistrationOptions.id, organizerOption.id));
      await database
        .update(schema.eventInstances)
        .set({ listingAudience: event.listingAudience })
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
        .set({ listingAudience: 'unlisted' })
        .where(eq(schema.eventInstances.id, event.id));

      await page.goto(`/events/${event.id}`);
      await expect(
        page.getByRole('heading', { name: event.title }),
      ).toBeVisible({ timeout: 15_000 });
    } finally {
      await database
        .update(schema.eventInstances)
        .set({ listingAudience: event.listingAudience })
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
        .set({ listingAudience: 'unlisted' })
        .where(eq(schema.eventInstances.id, event.id));

      await page.goto('/events');
      const eventCard = await waitForEventCard(page, event.id);
      await expect(
        eventCard.getByText('Unlisted', { exact: true }),
      ).toBeVisible();
    } finally {
      await database
        .update(schema.eventInstances)
        .set({ listingAudience: event.listingAudience })
        .where(eq(schema.eventInstances.id, event.id));
    }
  });
});
