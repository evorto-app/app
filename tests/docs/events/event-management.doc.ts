import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Create and manage events @track(playwright-specs-track-linking_20260126) @doc(EVENT-MANAGEMENT-DOC-01)', async ({
  page,
}, testInfo) => {
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
  await page.waitForTimeout(1000);
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
  await page.waitForTimeout(1000);
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

  // Click the "Create event" link to navigate to the event creation form
  await page.getByRole('link', { name: 'Create event' }).click();

  // Fill in event details
  await page.getByLabel('Event Title').fill(templateName);
  // Skip modifying the description as it's already prefilled with appropriate content

  // Create the event
  await page.getByRole('button', { name: 'Create Event' }).click();

  // Wait for the event details page to load
  await page.waitForSelector(`h1:has-text("${templateName}")`);

  // Wait for the page to stabilize
  await page.waitForTimeout(1000);

  await testInfo.attach('markdown', {
    body: `
## Event Details

After creating an event, you'll be taken to the event details page. This page shows the event title, description, registration section, review status, and organizer actions that are available to your account.
`,
  });

  // Use a more specific selector that's guaranteed to be on the page
  await takeScreenshot(
    testInfo,
    page.locator(`h1:has-text("${templateName}")`).first(),
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
  await page.waitForTimeout(1000);
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { level: 2, name: 'Registration' }).first(),
    page,
    'Registration options section',
  );

  await testInfo.attach('markdown', {
    body: `
## Event Status and Visibility

You can control how your event appears in the app with event status and listing visibility.

Event status values:

- **Draft**
- **Pending Review**
- **Approved**
- **Rejected**

Listing visibility can be updated from the event actions menu.

For a full walkthrough of the review and approval lifecycle, see the dedicated Event Approval guide.
`,
  });

  // Take a screenshot of the event status section
  await page.waitForTimeout(1000);
  const statusChip = page
    .getByText(/Draft|Pending Review|Approved|Rejected/i)
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
- Event receipt submission and receipt list

It does not currently include attendee export, attendee messaging, manual check-in controls, or registration cancellation controls.
Those flows should be documented separately when they exist in the product.

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
