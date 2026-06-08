import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { getId } from '../../../helpers/get-id';
import {
  adminStateFile,
  usersToAuthenticate,
} from '../../../helpers/user-data';
import {
  eventRegistrationOptions,
  eventRegistrations,
} from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Create and manage events', async ({
  database,
  events,
  page,
  roles,
  seeded,
}, testInfo) => {
  const target = events.find(
    (event) => event.id === seeded.scenario.events.freeOpen.eventId,
  );
  if (!target) {
    throw new Error(
      'Seeded freeOpen scenario event was not found for event-management docs',
    );
  }

  await page.goto('.');
  await expect(page.getByRole('link', { name: 'Admin Tools' })).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have an account with the required permissions. These are:
- **events:create**: This permission is required to create new events.
- **events:editAll**: This permission is required to manage and edit events.
{% /callout %}

# Event Management

The event management feature allows you to create, edit, and manage events in the application. This includes setting up registration options, managing attendees, and controlling event visibility.
The current management surface is intentionally focused: event details, registration options, review/listing actions, organizer participant overview, and event receipts.

## Event List

Start by navigating to the **Events** section from the main menu to see a list of all events.
`,
  });

  await page.getByRole('link', { name: 'Events' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Events' }).first(),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { level: 1, name: 'Events' }).first(),
    page,
    'Event list page',
  );

  await testInfo.attach('markdown', {
    body: `
The event list shows all events with their basic information:

- Event title
- Date and time
- Location
- Status (draft, pending review, approved, rejected)
- Listing state (listed or unlisted)
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Creating a New Event

To create a new event, click the **Create Event** link on the event list page. This will take you to the templates page where you can select a template for your new event.
`,
  });

  await page.getByRole('link', { name: 'Create Event' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Event templates' }).first(),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { level: 1, name: 'Event templates' }).first(),
    page,
    'Templates page',
  );

  await testInfo.attach('markdown', {
    body: `
On the templates page, you can browse different event templates organized by category. Select a template that matches the type of event you want to create.

Once you've selected a template, you'll be able to customize it with your event details:

- Event title
- Event description
- Date and time
- Location
- Registration options

After selecting a template and customizing your event, you can create it and proceed to the event details page.
`,
  });

  const templateName = 'Partnach Gorge hike';

  // Select a template from the list
  await page.getByRole('link', { name: templateName }).click();

  // The remaining screenshots use a seeded event with the same event-details surface.
  await page.goto(`/events/${target.id}`);

  // Wait for the event details page to load
  await expect(
    page.locator(`h1:has-text("${target.title}")`).first(),
  ).toBeVisible();

  await testInfo.attach('markdown', {
    body: `
## Event Details

After creating an event, you'll be taken to the event details page. This page shows the event title, description, registration section, review status, and organizer actions that are available to your account.
`,
  });

  // Use a more specific selector that's guaranteed to be on the page
  await takeScreenshot(
    testInfo,
    page.locator(`h1:has-text("${target.title}")`).first(),
    page,
    'Event details page',
  );

  await testInfo.attach('markdown', {
    body: `
The event details page has several sections:

- **Basic Information**: Title, description, date, location
- **Registration**: Available registration options or your active registration
- **Review and listing actions**: Status, submit/review actions, edit link, and listing controls when your permissions allow them
- **Organize this event**: A link to the organizer surface when you are allowed to organize the event

Let's look at each section in detail.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Registration Options

Registration options determine how people can sign up for your event. Templates can create one or more registration options that are then shown on the event details page.
Reusable add-ons copied from the source template are shown separately on the event detail page with their price, purchase timing, quantity limits, and attached registration options.

When editing a draft or rejected event, registration options can include:

- Option title
- Price (free or paid)
- Registration period (when registration opens and closes)
- Maximum number of registrations
- Required roles (if the option is restricted to certain user roles)
- Organizer/helper distinction

Configure the options according to your event's needs and click **Save Changes**.

Note: The event created from the template already has registration options configured.
`,
  });

  // Take a screenshot of the existing registration options section
  await expect(
    page.getByRole('heading', { level: 2, name: 'Registration' }).first(),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { level: 2, name: 'Registration' }).first(),
    page,
    'Registration options section',
  );

  const draftEvent = events.find(
    (event) => event.status === 'DRAFT' && event.registrationOptions.length > 0,
  );
  if (!draftEvent) {
    throw new Error(
      'Expected seeded draft event for event-management role autocomplete docs',
    );
  }
  const registrationOption = draftEvent.registrationOptions[0];
  const selectedRole = roles.find((role) =>
    registrationOption.roleIds.includes(role.id),
  );
  if (!selectedRole) {
    throw new Error(
      `Expected seeded event-management docs draft event "${draftEvent.title}" to have selected registration roles`,
    );
  }
  const unselectedRole = roles.find(
    (role) => !registrationOption.roleIds.includes(role.id),
  );
  if (!unselectedRole) {
    throw new Error(
      `Expected seeded event-management docs draft event "${draftEvent.title}" to have an unselected role for autocomplete`,
    );
  }

  await page.goto(`/events/${draftEvent.id}/edit`);
  await expect(page).toHaveURL(`/events/${draftEvent.id}/edit`);
  await expect(
    page.locator('app-event-edit').getByRole('heading', {
      name: draftEvent.title,
    }),
  ).toBeVisible();
  await expect(page.getByText(selectedRole.name).first()).toBeVisible();
  const roleInput = page.getByPlaceholder('Add Role...').first();
  await roleInput.click();
  await expect(
    page.getByRole('option', {
      exact: true,
      name: selectedRole.name,
    }),
  ).toHaveCount(0);
  await page
    .getByRole('option', { exact: true, name: unselectedRole.name })
    .click();
  await roleInput.click();
  await expect(
    page.getByRole('option', {
      exact: true,
      name: unselectedRole.name,
    }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');

  await testInfo.attach('markdown', {
    body: `
Role picker behavior: already selected roles are hidden from suggestions to avoid duplicate eligibility entries. The event edit form uses lookup-only role labels for this authoring flow rather than exposing role-management permission details.
`,
  });
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { name: draftEvent.title }).first(),
    page,
    'Event edit role picker duplicate prevention',
  );

  await testInfo.attach('markdown', {
    body: `
## Event Status and Visibility

You can control how your event appears in the app with event status and listing visibility.

Event status values:

- **Draft**
- **Pending Review**
- **Published**
- **Rejected**

Listing visibility can be updated from the event actions menu.

For a full walkthrough of the review and approval lifecycle, see the dedicated Event Approval guide.
`,
  });

  // Take a screenshot of the event status section
  const statusChip = page
    .getByText(/Draft|Pending Review|Published|Rejected/i)
    .first();
  try {
    await statusChip.waitFor({ state: 'visible', timeout: 2000 });
    await takeScreenshot(testInfo, statusChip, page, 'Event status section');
  } catch {
    await testInfo.attach('markdown', {
      body: `
_Note: Event status is not displayed in this view in the current build._
`,
    });
  }

  await testInfo.attach('markdown', {
    body: `
## Organizer View

Once people start registering for your event, organizers can open the **Organize this event** view from the event details page.

The organizer view currently includes:

- Event capacity overview
- Checked-in count
- Participants grouped by registration option
- ESNcard discount markers where applicable
- Registration-time add-ons purchased by each participant
- Event receipt submission and receipt list

Organizers check in attendees from the dedicated QR scanner. Attendees open their ticket QR code from the event registration page after a confirmed registration, and organizers scan it from **Scan**. The scanned-registration page shows the attendee, event, registration option, ESNcard discount marker when applicable, guest check-in progress when guests are attached to the registration, and warnings for self-scan, future events, non-confirmed registrations, and already checked-in tickets.

Check-in is available to event organizers and users with event-wide organize access during the current check-in window. The scanner shows a future-event warning before that window opens. Confirming check-in records the registration check-in time and updates the checked-in count shown on the organizer overview. When a registration includes guests, the organizer chooses how many guests arrived with the attendee, and the checked-in count increases by the attendee plus the selected guests.
Organizers can also cancel a participant's confirmed registration from the organizer overview before check-in, which releases the confirmed spot and submits a Stripe refund when the paid registration has a stored Stripe payment reference. Older or manually seeded payment records still create a pending manual refund record for organizer follow-up.
For unpaid registrations, organizers can transfer a not-yet-checked-in participant registration to another eligible tenant member. Paid registration transfer shows as unavailable in the organizer overview until the resale money flow is handled.

It does not currently include attendee export, attendee messaging, manual check-in controls outside QR scanning, participant self-service resale, paid registration transfer, or participant-facing refund controls.
Those flows should be documented separately when they exist in the product.
`,
  });

  const scannerEventId = seeded.scenario.events.past.eventId;
  const [scannerRegistrationOption] = await database
    .select()
    .from(eventRegistrationOptions)
    .where(
      and(
        eq(eventRegistrationOptions.eventId, scannerEventId),
        eq(eventRegistrationOptions.organizingRegistration, false),
      ),
    )
    .limit(1);
  if (!scannerRegistrationOption) {
    throw new Error(
      'Expected seeded participant option for scanner documentation',
    );
  }
  const initialCheckedInSpots = scannerRegistrationOption.checkedInSpots;
  const scannerUser = usersToAuthenticate.find((user) => user.roles === 'user');
  if (!scannerUser) {
    throw new Error('Expected regular user fixture for scanner documentation');
  }
  const scannerRegistrationId = getId();

  try {
    await database.insert(eventRegistrations).values({
      checkedInGuestCount: 0,
      eventId: scannerEventId,
      guestCount: 2,
      id: scannerRegistrationId,
      registrationOptionId: scannerRegistrationOption.id,
      status: 'CONFIRMED',
      tenantId: seeded.tenant.id,
      userId: scannerUser.id,
    });

    await page.goto(`/scan/registration/${scannerRegistrationId}`);
    await expect(
      page.getByRole('heading', { name: 'Registration scanned' }),
    ).toBeVisible();
    await expect(page.getByText('Includes 2 guests.')).toBeVisible();
    await expect(page.getByText('0 checked in, 2 remaining.')).toBeVisible();
    await page.getByLabel('Guests to check in now').fill('2');
    await expect(
      page.getByRole('button', { name: 'Confirm 3 check-ins' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.locator('app-handle-registration'),
      page,
      'Scanned registration with guest check-in',
    );
    await page.getByRole('button', { name: 'Confirm 3 check-ins' }).click();
    await expect(page.getByText('Check-in recorded')).toBeVisible();
    await expect
      .poll(async () => {
        const registration = await database.query.eventRegistrations.findFirst({
          columns: {
            checkInTime: true,
            checkedInGuestCount: true,
          },
          where: { id: scannerRegistrationId },
        });
        const option = await database.query.eventRegistrationOptions.findFirst({
          columns: {
            checkedInSpots: true,
          },
          where: { id: scannerRegistrationOption.id },
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
        checkedInSpots: initialCheckedInSpots + 3,
      });
    await page.goto(`/events/${scannerEventId}/organize`);
    await expect(page.getByTestId('event-organize-checked-in-stat')).toHaveText(
      new RegExp(`^${initialCheckedInSpots + 3}\\s*Checked In$`),
    );
  } finally {
    await database
      .delete(eventRegistrations)
      .where(eq(eventRegistrations.id, scannerRegistrationId));
    await database
      .update(eventRegistrationOptions)
      .set({ checkedInSpots: initialCheckedInSpots })
      .where(
        and(
          eq(eventRegistrationOptions.id, scannerRegistrationOption.id),
          eq(
            eventRegistrationOptions.checkedInSpots,
            initialCheckedInSpots + 3,
          ),
        ),
      );
  }

  await testInfo.attach('markdown', {
    body: `

## Event Editing

Draft and rejected events can be edited from the event details page when your permissions allow it.
The edit form covers the same event details and registration options used during event creation.
Pending-review and approved events are locked from normal editing.

## Current Scope

There is no general event settings tab in the current event UI.
Template categories are managed from the templates area, not from individual events.
Featured images, event tags, custom confirmation messages, notification settings, external integrations, and event deletion are not part of the current event management surface.
`,
  });
});
