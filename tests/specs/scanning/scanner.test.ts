import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { getId } from '../../../helpers/get-id';
import type { SeedTenantResult } from '../../../helpers/seed-tenant';
import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import type { relations } from '../../../src/db/relations';
import {
  eventInstances,
  eventRegistrationOptions,
  eventRegistrations,
} from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: adminStateFile });

type TestDatabase = NodePgDatabase<typeof relations>;

const requireScannerFixture = async ({
  database,
  seeded,
}: {
  database: TestDatabase;
  seeded: SeedTenantResult;
}) => {
  const eventId = seeded.scenario.events.past.eventId;
  const event = seeded.events.find((seededEvent) => seededEvent.id === eventId);
  if (!event) {
    throw new Error('Expected seeded past event for scanner coverage');
  }

  const registrationOption = event.registrationOptions.find(
    (option) => !option.organizingRegistration,
  );
  if (!registrationOption) {
    throw new Error(
      'Expected participant registration option for scanner coverage',
    );
  }

  const [optionBefore] = await database
    .select({ checkedInSpots: eventRegistrationOptions.checkedInSpots })
    .from(eventRegistrationOptions)
    .where(
      and(
        eq(eventRegistrationOptions.eventId, eventId),
        eq(eventRegistrationOptions.id, registrationOption.id),
      ),
    );
  if (!optionBefore) {
    throw new Error(
      `Expected registration option "${registrationOption.id}" for seeded scanner event`,
    );
  }

  const eventBefore = await database.query.eventInstances.findFirst({
    columns: {
      end: true,
      start: true,
    },
    where: {
      id: eventId,
    },
  });
  if (!eventBefore) {
    throw new Error(`Expected seeded scanner event "${eventId}"`);
  }

  const regularUser = usersToAuthenticate.find((user) => user.roles === 'user');
  if (!regularUser) {
    throw new Error('Expected regular user fixture for scanner coverage');
  }

  return {
    eventId,
    eventBefore,
    optionBefore,
    registrationOptionId: registrationOption.id,
    tenantId: seeded.tenant.id,
    userId: regularUser.id,
  };
};

const openScannerCheckInWindow = async ({
  database,
  eventId,
}: {
  database: TestDatabase;
  eventId: string;
}) => {
  const scannerEventStart = DateTime.utc().plus({ minutes: 30 });
  await database
    .update(eventInstances)
    .set({
      end: scannerEventStart.plus({ hours: 2 }).toJSDate(),
      start: scannerEventStart.toJSDate(),
    })
    .where(eq(eventInstances.id, eventId));
};

test('scan confirmed registration records check-in', async ({
  database,
  page,
  seeded,
}) => {
  const scannerFixture = await requireScannerFixture({ database, seeded });
  const registrationId = getId();

  try {
    await openScannerCheckInWindow({
      database,
      eventId: scannerFixture.eventId,
    });
    await database.insert(eventRegistrations).values({
      checkedInGuestCount: 0,
      eventId: scannerFixture.eventId,
      guestCount: 2,
      id: registrationId,
      registrationOptionId: scannerFixture.registrationOptionId,
      status: 'CONFIRMED',
      tenantId: scannerFixture.tenantId,
      userId: scannerFixture.userId,
    });

    await page.goto(`/scan/registration/${registrationId}`);
    await expect(
      page.getByRole('heading', { name: 'Registration scanned' }),
    ).toBeVisible();
    await page.getByLabel('Guests to check in now').fill('2');
    await page.getByRole('button', { name: 'Confirm 3 check-ins' }).click();
    await expect(page.getByText('Check-in recorded')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Confirm check-in' }),
    ).toBeDisabled();

    await expect
      .poll(async () => {
        const [registration] = await database
          .select({
            checkedInGuestCount: eventRegistrations.checkedInGuestCount,
            checkInTime: eventRegistrations.checkInTime,
          })
          .from(eventRegistrations)
          .where(eq(eventRegistrations.id, registrationId));
        const [option] = await database
          .select({ checkedInSpots: eventRegistrationOptions.checkedInSpots })
          .from(eventRegistrationOptions)
          .where(
            eq(
              eventRegistrationOptions.id,
              scannerFixture.registrationOptionId,
            ),
          );

        return {
          checkedIn: registration?.checkInTime !== null,
          checkedInGuestCount: registration?.checkedInGuestCount,
          checkedInSpots: option?.checkedInSpots,
        };
      })
      .toEqual({
        checkedIn: true,
        checkedInGuestCount: 2,
        checkedInSpots: scannerFixture.optionBefore.checkedInSpots + 3,
      });

    await page.goto(`/events/${scannerFixture.eventId}/organize`);
    await expect(page.getByTestId('event-organize-checked-in-stat')).toHaveText(
      new RegExp(
        `^${scannerFixture.optionBefore.checkedInSpots + 3}\\s*Checked In$`,
      ),
    );
  } finally {
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
    await database
      .update(eventRegistrationOptions)
      .set({ checkedInSpots: scannerFixture.optionBefore.checkedInSpots })
      .where(
        eq(eventRegistrationOptions.id, scannerFixture.registrationOptionId),
      );
    await database
      .update(eventInstances)
      .set({
        end: scannerFixture.eventBefore.end,
        start: scannerFixture.eventBefore.start,
      })
      .where(eq(eventInstances.id, scannerFixture.eventId));
  }
});

test('scan checked-in registration records remaining guest arrival', async ({
  database,
  page,
  seedDate,
  seeded,
}) => {
  const scannerFixture = await requireScannerFixture({ database, seeded });
  const registrationId = getId();
  const checkedInBaseline = scannerFixture.optionBefore.checkedInSpots + 2;

  try {
    await openScannerCheckInWindow({
      database,
      eventId: scannerFixture.eventId,
    });
    await database.insert(eventRegistrations).values({
      checkedInGuestCount: 1,
      checkInTime: seedDate,
      eventId: scannerFixture.eventId,
      guestCount: 2,
      id: registrationId,
      registrationOptionId: scannerFixture.registrationOptionId,
      status: 'CONFIRMED',
      tenantId: scannerFixture.tenantId,
      userId: scannerFixture.userId,
    });
    await database
      .update(eventRegistrationOptions)
      .set({ checkedInSpots: checkedInBaseline })
      .where(
        eq(eventRegistrationOptions.id, scannerFixture.registrationOptionId),
      );

    await page.goto(`/scan/registration/${registrationId}`);
    await expect(
      page.getByRole('heading', { name: 'Registration scanned' }),
    ).toBeVisible();
    await expect(page.getByText('1 checked in, 1 remaining.')).toBeVisible();
    await expect(page.getByText('Already checked in')).toHaveCount(0);

    await page.getByLabel('Guests to check in now').fill('1');
    await page.getByRole('button', { name: 'Confirm check-in' }).click();
    await expect(page.getByText('Check-in recorded')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Confirm check-in' }),
    ).toBeDisabled();

    await expect
      .poll(async () => {
        const [registration] = await database
          .select({
            checkedInGuestCount: eventRegistrations.checkedInGuestCount,
            checkInTime: eventRegistrations.checkInTime,
          })
          .from(eventRegistrations)
          .where(eq(eventRegistrations.id, registrationId));
        const [option] = await database
          .select({ checkedInSpots: eventRegistrationOptions.checkedInSpots })
          .from(eventRegistrationOptions)
          .where(
            eq(
              eventRegistrationOptions.id,
              scannerFixture.registrationOptionId,
            ),
          );

        return {
          checkedIn: registration?.checkInTime !== null,
          checkedInGuestCount: registration?.checkedInGuestCount,
          checkedInSpots: option?.checkedInSpots,
        };
      })
      .toEqual({
        checkedIn: true,
        checkedInGuestCount: 2,
        checkedInSpots: checkedInBaseline + 1,
      });

    await page.goto(`/events/${scannerFixture.eventId}/organize`);
    await expect(page.getByTestId('event-organize-checked-in-stat')).toHaveText(
      new RegExp(`^${checkedInBaseline + 1}\\s*Checked In$`),
    );
  } finally {
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
    await database
      .update(eventRegistrationOptions)
      .set({ checkedInSpots: scannerFixture.optionBefore.checkedInSpots })
      .where(
        eq(eventRegistrationOptions.id, scannerFixture.registrationOptionId),
      );
    await database
      .update(eventInstances)
      .set({
        end: scannerFixture.eventBefore.end,
        start: scannerFixture.eventBefore.start,
      })
      .where(eq(eventInstances.id, scannerFixture.eventId));
  }
});
