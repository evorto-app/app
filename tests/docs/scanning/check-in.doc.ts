import { and, eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import {
  adminStateFile,
  emptyStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import {
  eventRegistrationOptions,
  eventRegistrations,
} from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { installMockCamera } from '../../support/utils/mock-camera';
import { fillScannerGuestCheckInCount } from '../../support/utils/scanner-result-page';

test.use({ storageState: adminStateFile });

test('Check in event attendees', async ({
  database,
  page,
  seeded,
}, testInfo) => {
  const eventId = seeded.scenario.events.past.eventId;
  const event = seeded.events.find((seededEvent) => seededEvent.id === eventId);
  if (!event) {
    throw new Error('Expected seeded past event for check-in documentation');
  }

  const participantOption = event.registrationOptions.find(
    (option) => !option.organizingRegistration,
  );
  if (!participantOption) {
    throw new Error(
      'Expected seeded participant option for check-in documentation',
    );
  }

  const attendee = usersToAuthenticate.find(
    (user) => user.stateFile === emptyStateFile,
  );
  if (!attendee) {
    throw new Error('Expected regular user fixture for check-in documentation');
  }

  const [optionBefore] = await database
    .select({ checkedInSpots: eventRegistrationOptions.checkedInSpots })
    .from(eventRegistrationOptions)
    .where(
      and(
        eq(eventRegistrationOptions.eventId, eventId),
        eq(eventRegistrationOptions.id, participantOption.id),
      ),
    );
  if (!optionBefore) {
    throw new Error(
      `Expected registration option "${participantOption.id}" for check-in documentation`,
    );
  }

  const registrationId = getId();

  try {
    await database.insert(eventRegistrations).values({
      checkedInGuestCount: 0,
      eventId,
      guestCount: 2,
      id: registrationId,
      registrationOptionId: participantOption.id,
      status: 'CONFIRMED',
      tenantId: seeded.tenant.id,
      userId: attendee.id,
    });

    await installMockCamera(page, 'allowed');
    const appResponse = await page.goto('/');

    expect(appResponse?.headers()['permissions-policy']).toBe(
      'camera=(self), geolocation=(), microphone=()',
    );
    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Before you start" %}
You need a confirmed organizer/helper registration for the event or the **Organize all events** permission. Check-in is available during the event's check-in window. Use a secure, current browser on a device with a camera.
{% /callout %}

# Check in event attendees

This guide explains the complete check-in flow, including camera access, attendee verification, guests arriving at different times, and duplicate scans.

## Open the scanner

1. Sign in to the tenant that owns the event.
2. Select **Scanner** in the main navigation.
3. If the browser asks for camera access, choose **Allow**.
4. Ask the attendee to open the confirmed ticket from their event registration page and hold its QR code inside the camera frame.

The ticket identifies a registration; it is not permission to check someone in by itself. Evorto still verifies your organizer access, the tenant, the event, and the registration status.
`,
    });

    const scanLink = page.getByRole('link', { exact: true, name: 'Scanner' });
    await expect(scanLink).toBeVisible();
    await takeScreenshot(
      testInfo,
      scanLink,
      page,
      'Open Scanner from navigation',
    );
    await scanLink.click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Scanner' }),
    ).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Camera ready.' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-scanner'),
      page,
      'Camera ready to scan a ticket',
    );

    await testInfo.attach('markdown', {
      body: `
### If the camera does not start

- Allow camera access for this site in the browser settings, then select **Try camera again**.
- Close another app that may be using the camera.
- If the device has no usable camera, scan the ticket with a phone's camera and open its Evorto link while signed in as an authorized organizer.
- A visible error is different from an invalid ticket. Do not check someone in until Evorto shows the registration details.

## Verify the registration

After a valid ticket is scanned, check the attendee name, event, registration option, registration status, and any ESNcard notice before confirming. Evorto warns when the ticket belongs to the signed-in organizer, the event is too far in the future, the registration is not confirmed, or it has already been checked in.
`,
    });

    await page.goto(`/scan/registration/${registrationId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Registration scanned' }),
    ).toBeVisible();
    await expect(page.getByText('Event starting in the future')).toHaveCount(0);
    await expect(page.getByText('Includes 2 guests.')).toBeVisible();
    await expect(page.getByText('0 checked in, 2 remaining.')).toBeVisible();
    const confirmAttendeeAndGuest = await fillScannerGuestCheckInCount(page, {
      guestCount: 1,
      includeAttendee: true,
    });
    await takeScreenshot(
      testInfo,
      page.locator('app-handle-registration'),
      page,
      'Verify attendee and first arriving guest',
    );
    await confirmAttendeeAndGuest.click();
    await expect(page.getByText('Check-in recorded')).toBeVisible();

    await expect
      .poll(async () => {
        const registration = await database.query.eventRegistrations.findFirst({
          columns: {
            checkedInGuestCount: true,
            checkInTime: true,
          },
          where: { id: registrationId },
        });
        const option = await database.query.eventRegistrationOptions.findFirst({
          columns: { checkedInSpots: true },
          where: { id: participantOption.id },
        });

        return {
          attendeeCheckedIn: registration?.checkInTime !== null,
          checkedInGuestCount: registration?.checkedInGuestCount,
          checkedInSpots: option?.checkedInSpots,
        };
      })
      .toEqual({
        attendeeCheckedIn: true,
        checkedInGuestCount: 1,
        checkedInSpots: optionBefore.checkedInSpots + 2,
      });

    await testInfo.attach('markdown', {
      body: `
## Check in guests who arrive later

The first confirmation above checks in the attendee and one guest. If another guest arrives later, scan the same ticket again. Evorto shows how many guests are already checked in and how many remain. Select only the number arriving now.
`,
    });

    await page.goto(`/scan/registration/${registrationId}`);
    await expect(page.getByText('1 checked in, 1 remaining.')).toBeVisible();
    const confirmRemainingGuest = await fillScannerGuestCheckInCount(page, {
      guestCount: 1,
      includeAttendee: false,
    });
    await confirmRemainingGuest.click();
    await expect(page.getByText('Check-in recorded')).toBeVisible();

    await page.goto(`/scan/registration/${registrationId}`);
    await expect(page.getByText('Already checked in')).toBeVisible();
    await expect(page.getByText('2 checked in, 0 remaining.')).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-handle-registration'),
      page,
      'Completed check-in and duplicate-scan warning',
    );

    await page.goto(`/events/${eventId}/organize`);
    await expect(page.getByTestId('event-organize-checked-in-stat')).toHaveText(
      String(optionBefore.checkedInSpots + 3),
      { timeout: 15_000 },
    );
    await takeScreenshot(
      testInfo,
      page.getByTestId('event-organize-checked-in-stat'),
      page,
      'Organizer checked-in total',
    );

    await testInfo.attach('markdown', {
      body: `
## What completion means

The organizer overview increases by the attendee plus the guests actually checked in. Re-scanning a fully checked-in ticket does not add to the count again; Evorto shows **Already checked in** instead.

Never bypass a warning by changing the URL or using another tenant. Ask a tenant administrator to review your organizer access or the attendee's registration when the displayed details are not correct.
`,
    });
  } finally {
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
    await database
      .update(eventRegistrationOptions)
      .set({ checkedInSpots: optionBefore.checkedInSpots })
      .where(eq(eventRegistrationOptions.id, participantOption.id));
  }
});
