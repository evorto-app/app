import { and, eq } from 'drizzle-orm';

import { getId } from '../../../helpers/get-id';
import {
  adminStateFile,
  emptyStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import {
  eventInstances,
  eventRegistrationOptions,
  eventRegistrations,
  users,
  usersToTenants,
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
  testClock,

  registerDatabaseCleanup,
}, testInfo) => {
  const eventId = seeded.scenario.events.past.eventId;
  const event = seeded.events.find((seededEvent) => seededEvent.id === eventId);
  if (!event) {
    throw new Error('Expected seeded past event for check-in documentation');
  }

  const participantOption = event.registrationOptions.find(
    (option) => !option.organizingRegistration && !option.isPaid,
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
    .select({
      checkedInSpots: eventRegistrationOptions.checkedInSpots,
      confirmedSpots: eventRegistrationOptions.confirmedSpots,
      reservedSpots: eventRegistrationOptions.reservedSpots,
      spots: eventRegistrationOptions.spots,
    })
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
  const [eventBefore] = await database
    .select({
      end: eventInstances.end,
      start: eventInstances.start,
    })
    .from(eventInstances)
    .where(eq(eventInstances.id, eventId));
  if (!eventBefore) {
    throw new Error(`Expected event "${eventId}" for check-in documentation`);
  }

  const registrationId = getId();
  const registrationSpotCount = 3;
  const confirmedSpots = optionBefore.confirmedSpots + registrationSpotCount;
  if (
    confirmedSpots + optionBefore.reservedSpots > optionBefore.spots ||
    optionBefore.checkedInSpots > confirmedSpots
  ) {
    throw new Error(
      `Registration option "${participantOption.id}" lacks coherent capacity for check-in documentation`,
    );
  }
  const scannerNow = testClock.toJSDate();
  const openEventStart = new Date(scannerNow.getTime() - 30 * 60 * 1000);
  const openEventEnd = new Date(scannerNow.getTime() + 30 * 60 * 1000);

  registerDatabaseCleanup(async () => {
    await database
      .update(eventInstances)
      .set({ end: eventBefore.end, start: eventBefore.start })
      .where(eq(eventInstances.id, eventId));
  });
  registerDatabaseCleanup(async () => {
    await database
      .update(eventRegistrationOptions)
      .set({
        checkedInSpots: optionBefore.checkedInSpots,
        confirmedSpots: optionBefore.confirmedSpots,
      })
      .where(eq(eventRegistrationOptions.id, participantOption.id));
  });
  registerDatabaseCleanup(async () => {
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
  });
  {
    await database
      .update(eventInstances)
      .set({ end: openEventEnd, start: openEventStart })
      .where(eq(eventInstances.id, eventId));
    await database.transaction(async (transaction) => {
      const updatedOptions = await transaction
        .update(eventRegistrationOptions)
        .set({ confirmedSpots })
        .where(
          and(
            eq(eventRegistrationOptions.eventId, eventId),
            eq(eventRegistrationOptions.id, participantOption.id),
            eq(
              eventRegistrationOptions.checkedInSpots,
              optionBefore.checkedInSpots,
            ),
            eq(
              eventRegistrationOptions.confirmedSpots,
              optionBefore.confirmedSpots,
            ),
          ),
        )
        .returning({ id: eventRegistrationOptions.id });
      if (updatedOptions.length !== 1) {
        throw new Error(
          `Registration option "${participantOption.id}" counters changed before check-in documentation setup`,
        );
      }

      await transaction.insert(eventRegistrations).values({
        appliedDiscountedPrice: null,
        appliedDiscountType: null,
        basePriceAtRegistration: participantOption.price,
        checkedInGuestCount: 0,
        discountAmount: 0,
        eventId,
        guestCount: 2,
        id: registrationId,
        registrationOptionId: participantOption.id,
        status: 'CONFIRMED',
        tenantId: seeded.tenant.id,
        userId: attendee.id,
      });
    });

    await installMockCamera(page, 'allowed');
    const appResponse = await page.goto('/');

    expect(appResponse?.headers()['permissions-policy']).toBe(
      'camera=(self), geolocation=(), microphone=()',
    );
    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Who can do this" %}
You need a confirmed organizer/helper ticket for the event or **Organize all events** access. Check-in opens one hour before the event starts and closes two hours after it ends. Use an up-to-date device with a camera.
{% /callout %}


This guide shows how to use the camera, check attendees and guests in, and handle a ticket that was already scanned.

## Open the scanner

1. Sign in to the organization that owns the event.
2. Select **Scanner** in the main navigation.
3. If your device asks for camera access, choose **Allow**.
4. Ask the attendee to open the confirmed ticket from the event page and hold its QR code inside the camera frame.

Only someone who can organize this event can check someone in. Scanning or sharing the ticket does not allow someone to organize the event.
`,
    });

    const scanLink = page.getByRole('link', { exact: true, name: 'Scanner' });
    await expect(scanLink).toBeVisible();
    await expect(page.locator('app-event-list nav a').first()).toBeVisible();
    await takeScreenshot(
      testInfo,
      scanLink,
      page,
      'Select Scanner to begin checking in attendees',
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

- Allow camera access for Evorto in your device settings, then select **Try camera again**.
- Close another app that may be using the camera.
- If the device has no usable camera, scan the ticket with a phone's camera and open its Evorto link while signed in with access to organize the event.
- A visible error is different from an invalid ticket. Do not check someone in until Evorto shows the ticket details.
- **Not an Evorto ticket** means Evorto cannot open the scanned code. Ask the attendee to show the QR code from their confirmed ticket rather than a payment receipt or another screenshot, then select **Scan another code**. Nothing is checked in from that code.

## Verify the ticket

After a valid ticket is scanned, check the attendee name, event, sign-up choice, whether the ticket is confirmed, and any ESNcard notice before confirming. Evorto explains why a ticket cannot be used:

- **Sign-up pending** means the attendee must open the event or Profile to see whether organizer approval or their existing payment is still needed. Do not start another sign-up or payment from the scanner.
- **On waitlist** means the attendee has no confirmed place. Ask an organizer to review the waitlist and available places; do not take payment or start another sign-up from the scanner.
- **Sign-up ended** means the attendee cannot be checked in. Do not ask them to pay or sign up again. Ask an organizer to review the cancellation or refund if it looks wrong.
- **Check-in closed** means the event ended more than two hours ago. The attendee is not checked in. Organizers cannot correct published event times, so contact Evorto support if the times are wrong.

The scanner also warns when the ticket belongs to the signed-in organizer, check-in has not opened yet, or a confirmed ticket has already been checked in.
`,
    });

    await database
      .update(eventRegistrations)
      .set({ status: 'PENDING' })
      .where(eq(eventRegistrations.id, registrationId));
    const addonFulfillmentResponsePromise = page.waitForResponse((response) => {
      const request = response.request();
      return (
        new URL(request.url()).pathname.replace(/\/+$/u, '') === '/rpc' &&
        request.method() === 'POST' &&
        (request.postData() ?? '').includes(
          'events.getRegistrationAddonFulfillment',
        )
      );
    });
    await page.goto(`/scan/registration/${registrationId}`);
    const addonFulfillmentResponse = await addonFulfillmentResponsePromise;
    expect(addonFulfillmentResponse.ok()).toBe(true);
    const pendingRegistrationAlert = page
      .getByRole('alert')
      .filter({ hasText: 'Sign-up pending' });
    await expect(pendingRegistrationAlert).toBeVisible();
    await expect(pendingRegistrationAlert).toContainText(
      'organizer approval or their existing payment',
    );
    await expect(pendingRegistrationAlert).toContainText(
      'Do not start another sign-up or payment from the scanner',
    );
    await expect(
      page.getByRole('button', { name: 'Confirm check-in' }),
    ).toBeDisabled();
    await expect(
      page.getByRole('status').filter({ hasText: 'Loading add-ons' }),
    ).toHaveCount(0);
    await takeScreenshot(
      testInfo,
      page.locator('app-handle-registration'),
      page,
      'Ticket waiting for organizer approval or payment',
    );

    await database
      .update(eventRegistrations)
      .set({ status: 'WAITLIST' })
      .where(eq(eventRegistrations.id, registrationId));
    await page.goto(`/scan/registration/${registrationId}`);
    const waitlistRegistrationAlert = page
      .getByRole('alert')
      .filter({ hasText: 'On waitlist' });
    await expect(waitlistRegistrationAlert).toBeVisible();
    await expect(waitlistRegistrationAlert).toContainText(
      'does not have a confirmed place yet',
    );
    await expect(waitlistRegistrationAlert).toContainText(
      'Do not take payment or start another sign-up from the scanner',
    );
    await expect(
      page.getByRole('button', { name: 'Confirm check-in' }),
    ).toBeDisabled();

    await database
      .update(eventRegistrations)
      .set({ status: 'CONFIRMED' })
      .where(eq(eventRegistrations.id, registrationId));
    await database
      .update(eventInstances)
      .set({
        end: new Date(scannerNow.getTime() - 3 * 60 * 60 * 1000),
        start: new Date(scannerNow.getTime() - 5 * 60 * 60 * 1000),
      })
      .where(eq(eventInstances.id, eventId));
    await page.goto(`/scan/registration/${registrationId}`);
    await expect(
      page.getByRole('alert').filter({ hasText: 'Check-in closed' }),
    ).toContainText('ended more than two hours ago');
    await expect(
      page.getByRole('button', { name: 'Confirm check-in' }),
    ).toBeDisabled();

    await database
      .update(eventInstances)
      .set({ end: openEventEnd, start: openEventStart })
      .where(eq(eventInstances.id, eventId));
    await page.goto(`/scan/registration/${registrationId}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Ticket scanned' }),
    ).toBeVisible();
    await expect(page.getByText('Check-in closed')).toHaveCount(0);
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
      'Choose the attendee and first guest who are arriving now',
    );
    await confirmAttendeeAndGuest.click();
    await expect(page.getByText('Check-in complete')).toBeVisible();

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

The first confirmation above checks in the attendee and one guest. If another guest arrives later, select **Back to scanner**, then scan the same ticket again. Evorto shows how many guests are already checked in and how many remain. Select only the number arriving now.
`,
    });

    await page.getByRole('link', { name: 'Back to scanner' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Scanner' }),
    ).toBeVisible();
    await page.goto(`/scan/registration/${registrationId}`);
    await expect(page.getByText('1 checked in, 1 remaining.')).toBeVisible();
    const confirmRemainingGuest = await fillScannerGuestCheckInCount(page, {
      guestCount: 1,
      includeAttendee: false,
    });
    await confirmRemainingGuest.click();
    await expect(page.getByText('Check-in complete')).toBeVisible();

    await page.getByRole('link', { name: 'Back to scanner' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Scanner' }),
    ).toBeVisible();
    await page.goto(`/scan/registration/${registrationId}`);
    await expect(page.locator('[ngh]')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByText('Already checked in')).toBeVisible();
    await expect(page.getByText('2 checked in, 0 remaining.')).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-handle-registration'),
      page,
      'Completed ticket shows that everyone is already checked in',
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
      'Organizer overview shows the updated checked-in total',
    );

    await testInfo.attach('markdown', {
      body: `
## What completion means

The organizer overview increases by the attendee plus the guests actually checked in. Re-scanning a fully checked-in ticket does not add to the count again; Evorto shows **Already checked in** instead.

Never bypass a warning by changing the link or using another organization. Ask an organization administrator to review your organizer access or the attendee's ticket when the displayed details are not correct.
`,
    });
  }
});

test('Check in from the attendee list', async ({
  database,
  page,
  seeded,
  testClock,

  registerDatabaseCleanup,
}, testInfo) => {
  const eventId = seeded.scenario.events.past.eventId;
  const event = seeded.events.find((seededEvent) => seededEvent.id === eventId);
  const participantOption = event?.registrationOptions.find(
    (option) => !option.organizingRegistration && !option.isPaid,
  );
  if (!participantOption) {
    throw new Error(
      'Expected seeded participant option for attendee list check-in documentation',
    );
  }

  const [optionBefore] = await database
    .select({
      checkedInSpots: eventRegistrationOptions.checkedInSpots,
      confirmedSpots: eventRegistrationOptions.confirmedSpots,
      reservedSpots: eventRegistrationOptions.reservedSpots,
      spots: eventRegistrationOptions.spots,
    })
    .from(eventRegistrationOptions)
    .where(
      and(
        eq(eventRegistrationOptions.eventId, eventId),
        eq(eventRegistrationOptions.id, participantOption.id),
      ),
    );
  const [eventBefore] = await database
    .select({
      end: eventInstances.end,
      start: eventInstances.start,
    })
    .from(eventInstances)
    .where(eq(eventInstances.id, eventId));
  if (!optionBefore || !eventBefore) {
    throw new Error(
      `Expected event "${eventId}" and its option for attendee list check-in documentation`,
    );
  }

  const registrationId = getId();
  const attendeeUserId = getId();
  const attendeeTenantUserId = getId();
  const attendeeEmail = `list-check-in-${attendeeUserId}@example.test`;
  const attendeeName = 'Alex Example';
  const registrationSpotCount = 2;
  const confirmedSpots = optionBefore.confirmedSpots + registrationSpotCount;
  if (
    confirmedSpots + optionBefore.reservedSpots > optionBefore.spots ||
    optionBefore.checkedInSpots > confirmedSpots
  ) {
    throw new Error(
      `Registration option "${participantOption.id}" lacks coherent capacity for attendee list check-in documentation`,
    );
  }
  const scannerNow = testClock.toJSDate();

  registerDatabaseCleanup(async () => {
    await database.delete(users).where(eq(users.id, attendeeUserId));
  });
  registerDatabaseCleanup(async () => {
    await database
      .delete(usersToTenants)
      .where(eq(usersToTenants.id, attendeeTenantUserId));
  });
  registerDatabaseCleanup(async () => {
    await database
      .update(eventInstances)
      .set({ end: eventBefore.end, start: eventBefore.start })
      .where(eq(eventInstances.id, eventId));
  });
  registerDatabaseCleanup(async () => {
    await database
      .update(eventRegistrationOptions)
      .set({
        checkedInSpots: optionBefore.checkedInSpots,
        confirmedSpots: optionBefore.confirmedSpots,
      })
      .where(eq(eventRegistrationOptions.id, participantOption.id));
  });
  registerDatabaseCleanup(async () => {
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, registrationId));
  });
  {
    await database
      .update(eventInstances)
      .set({
        end: new Date(scannerNow.getTime() + 30 * 60 * 1000),
        start: new Date(scannerNow.getTime() - 30 * 60 * 1000),
      })
      .where(eq(eventInstances.id, eventId));
    await database.transaction(async (transaction) => {
      await transaction.insert(users).values({
        auth0Id: `test|list-check-in-${attendeeUserId}`,
        communicationEmail: attendeeEmail,
        email: attendeeEmail,
        firstName: 'Alex',
        id: attendeeUserId,
        lastName: 'Example',
      });
      await transaction.insert(usersToTenants).values({
        id: attendeeTenantUserId,
        tenantId: seeded.tenant.id,
        userId: attendeeUserId,
      });
      const updatedOptions = await transaction
        .update(eventRegistrationOptions)
        .set({ confirmedSpots })
        .where(
          and(
            eq(eventRegistrationOptions.eventId, eventId),
            eq(eventRegistrationOptions.id, participantOption.id),
            eq(
              eventRegistrationOptions.checkedInSpots,
              optionBefore.checkedInSpots,
            ),
            eq(
              eventRegistrationOptions.confirmedSpots,
              optionBefore.confirmedSpots,
            ),
          ),
        )
        .returning({ id: eventRegistrationOptions.id });
      if (updatedOptions.length !== 1) {
        throw new Error(
          `Registration option "${participantOption.id}" counters changed before attendee list check-in documentation setup`,
        );
      }

      await transaction.insert(eventRegistrations).values({
        appliedDiscountedPrice: null,
        appliedDiscountType: null,
        basePriceAtRegistration: participantOption.price,
        checkedInGuestCount: 0,
        discountAmount: 0,
        eventId,
        guestCount: 1,
        id: registrationId,
        registrationOptionId: participantOption.id,
        status: 'CONFIRMED',
        tenantId: seeded.tenant.id,
        userId: attendeeUserId,
      });
    });

    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Who can do this" %}
You need a confirmed organizer/helper ticket for the event or **Organize all events** access. Check-in opens one hour before the event starts and closes two hours after it ends.
{% /callout %}

If an attendee cannot show their ticket, for example because their phone battery died, check them in from the organizer overview instead.
`,
    });

    await page.goto(`/events/${eventId}/organize`);
    const checkInButton = page.getByRole('button', {
      name: `Check in ${attendeeName}`,
    });
    await expect(checkInButton).toBeVisible({ timeout: 15_000 });
    await takeScreenshot(
      testInfo,
      checkInButton,
      page,
      'Select Check in next to the attendee in the registration list',
    );
    await checkInButton.click();

    const dialog = page.getByRole('dialog', {
      name: `Check in ${attendeeName}`,
    });
    await expect(dialog).toBeVisible();
    const confirmCheckIn = await fillScannerGuestCheckInCount(dialog, {
      guestCount: 1,
      includeAttendee: true,
    });
    await takeScreenshot(
      testInfo,
      dialog,
      page,
      'Choose how many guests are arriving now and confirm the check-in',
    );
    await testInfo.attach('markdown', {
      body: `
Choose how many guests are arriving with the attendee, then confirm. Guests who arrive after the attendee is checked in are checked in by scanning the ticket.
`,
    });
    await confirmCheckIn.click();

    await expect(dialog).toBeHidden();
    await expect(page.getByText(`${attendeeName} is checked in`)).toBeVisible();
    await expect(checkInButton).toHaveCount(0);
    const attendeeRow = page
      .getByTestId('event-organize-registration')
      .filter({ hasText: attendeeName });
    await expect(attendeeRow).toContainText('Checked in');
    await takeScreenshot(
      testInfo,
      attendeeRow,
      page,
      'The attendee is marked as checked in',
    );
  }
});
