import { eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import {
  eventRegistrationOptions,
  eventRegistrations,
} from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ storageState: adminStateFile });

test.skip('scan confirmed registration records check-in @track(playwright-specs-track-linking_20260126) @req(SCANNER-TEST-01)', async ({
  database,
  page,
  registrations,
  tenant,
}) => {
  let confirmedRegistration: (typeof registrations)[number] | undefined;
  let registrationBefore:
    | {
        checkInTime: Date | null;
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
    await page.goto(`/scan/registration/${confirmedRegistration.id}`);
    await expect(
      page.getByRole('heading', { name: 'Registration scanned' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Confirm Check In' }).click();
    await expect(page.getByText('Check-in recorded')).toBeVisible();

    await expect
      .poll(async () => {
        const registration = await database.query.eventRegistrations.findFirst({
          columns: {
            checkInTime: true,
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
          checkedInSpots: option?.checkedInSpots,
        };
      })
      .toEqual({
        checkedIn: true,
        checkedInSpots: optionBefore.checkedInSpots + 1,
      });
  } finally {
    await database
      .update(eventRegistrations)
      .set({ checkInTime: null })
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
