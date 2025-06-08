import { DateTime } from 'luxon';

import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Create and manage events', async ({ page }, testInfo) => {
  await page.goto('.');
  await expect(page.getByRole('link', { name: 'Admin Tools' })).toBeVisible();
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
  await page.waitForTimeout(1000);
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { name: 'Events', level: 1 }).first(),
    page,
    'Event list page',
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
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Creating a New Event

To create a new event, click the **Create Event** link on the event list page. This will take you to the templates page where you can select a template for your new event.
`,
  });

  await page.getByRole('link', { name: 'Create Event' }).click();
  await page.waitForTimeout(1000);
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { name: 'Event templates', level: 1 }).first(),
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
- And more

After selecting a template and customizing your event, you can create it and proceed to the event details page.
`,
  });

  // Select a template from the list
  await page.getByRole('link', { name: 'Partnach Gorge hike' }).click();

  // Click the "Create event" link to navigate to the event creation form
  await page.getByRole('link', { name: 'Create event' }).click();

  // Fill in event details
  await page.getByLabel('Event Title').fill('Partnach Gorge Exploration');
  // Skip modifying the description as it's already prefilled with appropriate content

  // Create the event
  await page.getByRole('button', { name: 'Create Event' }).click();

  // Wait for the event details page to load
  await page.waitForSelector('h1:has-text("Partnach Gorge hike")');

  // Wait for the page to stabilize
  await page.waitForTimeout(1000);

  await testInfo.attach('markdown', {
    body: `
## Event Details

After creating an event, you'll be taken to the event details page where you can configure additional settings.
`,
  });

  // Use a more specific selector that's guaranteed to be on the page
  await takeScreenshot(
    testInfo,
    page.locator('h1:has-text("Partnach Gorge hike")').first(),
    page,
    'Event details page',
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

When adding a registration option, you can configure:

- Option title (e.g., "Early Bird", "Regular", "VIP")
- Price (free or paid)
- Registration period (when registration opens and closes)
- Maximum number of registrations
- Required roles (if the option is restricted to certain user roles)
- Custom fields (additional information to collect from registrants)

Configure the options according to your event's needs and click **Save**.

Note: The event created from the template already has registration options configured.
`,
  });

  // Take a screenshot of the existing registration options section
  await page.waitForTimeout(1000);
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { name: 'Registration', level: 2 }).first(),
    page,
    'Registration options section',
  );

  await testInfo.attach('markdown', {
    body: `
## Event Visibility

You can control who can see and register for your event by setting its visibility.

The visibility options include:

- **Draft**: Only visible to you, not ready for registration
- **Pending Approval**: Waiting for administrator approval
- **Public**: Visible to everyone
- **Private**: Visible only to specific users or roles
- **Archived**: No longer active, kept for historical purposes

Select the appropriate visibility and click **Save**.

Note: The event created from the template starts in "Draft" status.
`,
  });

  // Take a screenshot of the event status section
  await page.waitForTimeout(1000);
  await takeScreenshot(
    testInfo,
    page.getByText('Draft').first(),
    page,
    'Event status section',
  );

  await testInfo.attach('markdown', {
    body: `
## Managing Attendees

Once people start registering for your event, you can manage the attendees from the event details page.

In the attendees section, you can:

- View a list of all registered attendees
- See registration details (registration time, option selected, payment status)
- Export the attendee list
- Send messages to attendees
- Check in attendees manually
- Cancel registrations if needed

This gives you complete control over your event's attendance.

## Event Settings

Additional event settings can be configured in the settings tab.

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

When submitting an event for review:

1. The event status changes to "Pending Approval"
2. Administrators are notified about the new event
3. They can review the event details and approve or reject it
4. Once approved, the event becomes visible according to its visibility settings

This process ensures quality control for all events in the system.
`,
  });

  // Take a screenshot of the Submit for Review button
  await page.waitForTimeout(1000);
  await takeScreenshot(
    testInfo,
    page.getByRole('button', { name: 'Submit for Review' }).first(),
    page,
    'Submit for review button',
  );
});
