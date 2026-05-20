import { eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import {
  eventRegistrationOptions,
  eventRegistrations,
} from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: adminStateFile });

test.skip('scan confirmed registration records check-in', async ({
  database,
  page,
  registrations,
  tenant,
}) => {
  let confirmedRegistration: (typeof registrations)[number] | undefined;
  let registrationBefore:
    | {
        checkInTime: Date | null;
        checkedInGuestCount: number;
        guestCount: number;
        registrationOptionId: string;
      }
    | undefined;

  for (const registration of registrations) {
    if (
      registration.status !== 'CONFIRMED' ||
      registration.tenantId !== tenant.id
    ) {
      continue;
    }

    const candidate = await database.query.eventRegistrations.findFirst({
      columns: {
        checkInTime: true,
        checkedInGuestCount: true,
        guestCount: true,
        registrationOptionId: true,
      },
      where: { id: registration.id },
    });

    if (candidate?.checkInTime === null) {
      confirmedRegistration = registration;
      registrationBefore = candidate;
      break;
    }
  }

  if (!confirmedRegistration || !registrationBefore) {
    throw new Error(
      'Expected an unchecked confirmed registration in the seeded scanner fixtures',
    );
  }

  const optionBefore = await database.query.eventRegistrationOptions.findFirst({
    columns: {
      checkedInSpots: true,
    },
    where: { id: registrationBefore.registrationOptionId },
  });
  if (!optionBefore) {
    throw new Error(
      `Expected registration option "${registrationBefore.registrationOptionId}" for seeded scanner registration`,
    );
  }

  try {
    await database
      .update(eventRegistrations)
      .set({
        checkedInGuestCount: 0,
        guestCount: 2,
      })
      .where(eq(eventRegistrations.id, confirmedRegistration.id));

    await page.goto(`/scan/registration/${confirmedRegistration.id}`);
    await expect(
      page.getByRole('heading', { name: 'Registration scanned' }),
    ).toBeVisible();
    await page.getByLabel('Guests to check in now').fill('2');
    await page.getByRole('button', { name: 'Confirm 3 check-ins' }).click();
    await expect(page.getByText('Check-in recorded')).toBeVisible();

    await expect
      .poll(async () => {
        const registration = await database.query.eventRegistrations.findFirst({
          columns: {
            checkInTime: true,
            checkedInGuestCount: true,
          },
          where: { id: confirmedRegistration.id },
        });
        const option = await database.query.eventRegistrationOptions.findFirst({
          columns: {
            checkedInSpots: true,
          },
          where: { id: registrationBefore.registrationOptionId },
        });

        return {
          checkedIn: registration?.checkInTime !== null,
          checkedInGuestCount: registration?.checkedInGuestCount,
          checkedInSpots: option?.checkedInSpots,
        };
      })
      .toEqual({
        checkedIn: true,
        checkedInGuestCount: 2,
        checkedInSpots: optionBefore.checkedInSpots + 3,
      });

    await page.goto(`/events/${confirmedRegistration.eventId}/organize`);
    await expect(page.getByTestId('event-organize-checked-in-stat')).toHaveText(
      new RegExp(`^${optionBefore.checkedInSpots + 3}\\s*Checked In$`),
    );
  } finally {
    await database
      .update(eventRegistrations)
      .set({
        checkInTime: null,
        checkedInGuestCount: registrationBefore.checkedInGuestCount,
        guestCount: registrationBefore.guestCount,
      })
      .where(eq(eventRegistrations.id, confirmedRegistration.id));
    await database
      .update(eventRegistrationOptions)
      .set({ checkedInSpots: optionBefore.checkedInSpots })
      .where(
        eq(
          eventRegistrationOptions.id,
          registrationBefore.registrationOptionId,
        ),
      );
  }
});

test('scan checked-in registration records remaining guest arrival', async ({
  database,
  page,
  registrations,
  seedDate,
  tenant,
}) => {
  let confirmedRegistration: (typeof registrations)[number] | undefined;
  let registrationBefore:
    | {
        checkInTime: Date | null;
        checkedInGuestCount: number;
        guestCount: number;
        registrationOptionId: string;
      }
    | undefined;

  for (const registration of registrations) {
    if (
      registration.status !== 'CONFIRMED' ||
      registration.tenantId !== tenant.id
    ) {
      continue;
    }

    const candidate = await database.query.eventRegistrations.findFirst({
      columns: {
        checkInTime: true,
        checkedInGuestCount: true,
        guestCount: true,
        registrationOptionId: true,
      },
      where: { id: registration.id },
    });

    if (candidate) {
      confirmedRegistration = registration;
      registrationBefore = candidate;
      break;
    }
  }

  if (!confirmedRegistration || !registrationBefore) {
    throw new Error(
      'Expected a confirmed registration in the seeded scanner fixtures',
    );
  }

  const optionBefore = await database.query.eventRegistrationOptions.findFirst({
    columns: {
      checkedInSpots: true,
    },
    where: { id: registrationBefore.registrationOptionId },
  });
  if (!optionBefore) {
    throw new Error(
      `Expected registration option "${registrationBefore.registrationOptionId}" for seeded scanner registration`,
    );
  }

  try {
    await database
      .update(eventRegistrations)
      .set({
        checkedInGuestCount: 1,
        checkInTime: seedDate,
        guestCount: 2,
      })
      .where(eq(eventRegistrations.id, confirmedRegistration.id));

    await page.goto(`/scan/registration/${confirmedRegistration.id}`);
    await expect(
      page.getByRole('heading', { name: 'Registration scanned' }),
    ).toBeVisible();
    await expect(page.getByText('1 checked in, 1 remaining.')).toBeVisible();
    await expect(page.getByText('Already checked in')).toHaveCount(0);

    await page.getByLabel('Guests to check in now').fill('1');
    await page.getByRole('button', { name: 'Confirm check-in' }).click();
    await expect(page.getByText('Check-in recorded')).toBeVisible();

    await expect
      .poll(async () => {
        const registration = await database.query.eventRegistrations.findFirst({
          columns: {
            checkInTime: true,
            checkedInGuestCount: true,
          },
          where: { id: confirmedRegistration.id },
        });
        const option = await database.query.eventRegistrationOptions.findFirst({
          columns: {
            checkedInSpots: true,
          },
          where: { id: registrationBefore.registrationOptionId },
        });

        return {
          checkedIn: registration?.checkInTime !== null,
          checkedInGuestCount: registration?.checkedInGuestCount,
          checkedInSpots: option?.checkedInSpots,
        };
      })
      .toEqual({
        checkedIn: true,
        checkedInGuestCount: 2,
        checkedInSpots: optionBefore.checkedInSpots + 1,
      });
  } finally {
    await database
      .update(eventRegistrations)
      .set({
        checkInTime: registrationBefore.checkInTime,
        checkedInGuestCount: registrationBefore.checkedInGuestCount,
        guestCount: registrationBefore.guestCount,
      })
      .where(eq(eventRegistrations.id, confirmedRegistration.id));
    await database
      .update(eventRegistrationOptions)
      .set({ checkedInSpots: optionBefore.checkedInSpots })
      .where(
        eq(
          eventRegistrationOptions.id,
          registrationBefore.registrationOptionId,
        ),
      );
  }
});
