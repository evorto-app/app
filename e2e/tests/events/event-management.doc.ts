import { DateTime } from 'luxon';

import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Create and manage events', async ({ page }, testInfo) => {
  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have an account with the required permissions. These are:
- **events:create**: This permission is required to create new events.
- **events:manage**: This permission is required to manage and edit events.
{% /callout %}

# Event Management

The event management feature allows you to create, edit, and manage events in the application. This includes setting up registration options, managing attendees, and controlling event visibility.

## Event List

Start by navigating to the **Events** section from the main menu to see a list of all events.
`,
  });

  await page.getByRole('link', { name: 'Events' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-event-list'),
    page,
    'Event list page'
  );

  await testInfo.attach('markdown', {
    body: `
The event list shows all events with their basic information:

- Event title
- Date and time
- Location
- Status (draft, pending approval, approved, etc.)
- Visibility (public, private, etc.)
- Number of registrations

You can filter events using the filter options at the top of the list.
`,
  });

  await page.getByRole('button', { name: 'Filter' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('mat-dialog-container'),
    page,
    'Event filter dialog'
  );

  await page.getByRole('button', { name: 'Cancel' }).click();

  await testInfo.attach('markdown', {
    body: `
## Creating a New Event

To create a new event, click the **Create Event** button on the event list page.
`,
  });

  await page.getByRole('button', { name: 'Create Event' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('mat-dialog-container'),
    page,
    'Create event dialog'
  );

  await testInfo.attach('markdown', {
    body: `
In the create event dialog, you need to provide:

- Event title
- Event description
- Date and time
- Location
- Event template (optional)

Fill in the required information and click **Create** to proceed.
`,
  });

  // Fill in basic event details
  await page.getByLabel('Title').fill('Documentation Test Event');
  await page.getByLabel('Description').fill('This is a test event for documentation purposes.');

  // Set date and time (adjust as needed based on the actual UI)
  const tomorrow = DateTime.now().plus({ days: 1 }).toFormat('MM/dd/yyyy');
  await page.getByLabel('Date').fill(tomorrow);

  await takeScreenshot(
    testInfo,
    page.locator('mat-dialog-container'),
    page,
    'Filled create event dialog'
  );

  await page.getByRole('button', { name: 'Create' }).click();

  await testInfo.attach('markdown', {
    body: `
## Event Details

After creating an event, you'll be taken to the event details page where you can configure additional settings.
`,
  });

  await takeScreenshot(
    testInfo,
    page.locator('app-event-details'),
    page,
    'Event details page'
  );

  await testInfo.attach('markdown', {
    body: `
The event details page has several sections:

- **Basic Information**: Title, description, date, location
- **Registration Options**: Configure how people can register for the event
- **Attendees**: View and manage people registered for the event
- **Settings**: Additional event settings and options

Let's look at each section in detail.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Registration Options

Registration options determine how people can sign up for your event. You can have multiple registration options with different settings.
`,
  });

  await page.getByRole('button', { name: 'Add Registration Option' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('mat-dialog-container'),
    page,
    'Add registration option dialog'
  );

  await testInfo.attach('markdown', {
    body: `
When adding a registration option, you can configure:

- Option title (e.g., "Early Bird", "Regular", "VIP")
- Price (free or paid)
- Registration period (when registration opens and closes)
- Maximum number of registrations
- Required roles (if the option is restricted to certain user roles)
- Custom fields (additional information to collect from registrants)

Configure the options according to your event's needs and click **Save**.
`,
  });

  // Fill in registration option details
  await page.getByLabel('Title').fill('Standard Registration');
  await page.getByLabel('Price').fill('0'); // Free event

  // Set registration period
  const today = DateTime.now().toFormat('MM/dd/yyyy');
  const nextWeek = DateTime.now().plus({ weeks: 1 }).toFormat('MM/dd/yyyy');
  await page.getByLabel('Registration opens').fill(today);
  await page.getByLabel('Registration closes').fill(nextWeek);

  await takeScreenshot(
    testInfo,
    page.locator('mat-dialog-container'),
    page,
    'Filled registration option dialog'
  );

  await page.getByRole('button', { name: 'Save' }).click();

  await testInfo.attach('markdown', {
    body: `
## Event Visibility

You can control who can see and register for your event by setting its visibility.
`,
  });

  await page.getByRole('button', { name: 'Update Visibility' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('mat-dialog-container'),
    page,
    'Update visibility dialog'
  );

  await testInfo.attach('markdown', {
    body: `
The visibility options include:

- **Draft**: Only visible to you, not ready for registration
- **Pending Approval**: Waiting for administrator approval
- **Public**: Visible to everyone
- **Private**: Visible only to specific users or roles
- **Archived**: No longer active, kept for historical purposes

Select the appropriate visibility and click **Save**.
`,
  });

  await page.getByRole('button', { name: 'Cancel' }).click();

  await testInfo.attach('markdown', {
    body: `
## Managing Attendees

Once people start registering for your event, you can manage the attendees from the event details page.
`,
  });

  await page.getByRole('tab', { name: 'Attendees' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-event-details'),
    page,
    'Attendees tab'
  );

  await testInfo.attach('markdown', {
    body: `
In the attendees section, you can:

- View a list of all registered attendees
- See registration details (registration time, option selected, payment status)
- Export the attendee list
- Send messages to attendees
- Check in attendees manually
- Cancel registrations if needed

This gives you complete control over your event's attendance.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Event Settings

Additional event settings can be configured in the settings tab.
`,
  });

  await page.getByRole('tab', { name: 'Settings' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('app-event-details'),
    page,
    'Settings tab'
  );

  await testInfo.attach('markdown', {
    body: `
The settings tab includes options for:

- Event categories and tags
- Featured image or banner
- Custom confirmation messages
- Notification settings
- Integration with other systems
- Event deletion

These settings help you customize the event experience and manage the event lifecycle.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Event Review and Approval

Depending on your organization's policies, events may need to go through a review and approval process before they become visible to users.
`,
  });

  await page.getByRole('button', { name: 'Submit for Review' }).click();
  await takeScreenshot(
    testInfo,
    page.locator('mat-dialog-container'),
    page,
    'Submit for review dialog'
  );

  await testInfo.attach('markdown', {
    body: `
When submitting an event for review:

1. The event status changes to "Pending Approval"
2. Administrators are notified about the new event
3. They can review the event details and approve or reject it
4. Once approved, the event becomes visible according to its visibility settings

This process ensures quality control for all events in the system.
`,
  });
});
