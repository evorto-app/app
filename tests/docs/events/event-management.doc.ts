import type { Locator, Page, Route } from '@playwright/test';

import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

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
} from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { fillScannerGuestCheckInCount } from '../../support/utils/scanner-result-page';

test.use({ storageState: adminStateFile });

const eventOptionEditorByTitle = async (
  page: Page,
  title: string,
): Promise<Locator> => {
  const editors = page.locator('app-event-registration-option-editor');
  const titleInputs = editors.getByRole('textbox', {
    exact: true,
    name: 'Option name',
  });
  let matchingIndex = -1;

  await expect
    .poll(
      async () => {
        const titles = await titleInputs.evaluateAll((elements) =>
          elements.map((element) => {
            if (!(element instanceof HTMLInputElement)) {
              throw new Error('Expected an event option title input');
            }
            return element.value;
          }),
        );
        matchingIndex = titles.indexOf(title);
        return matchingIndex;
      },
      {
        message: `Expected event registration option "${title}"`,
        timeout: 15_000,
      },
    )
    .toBeGreaterThanOrEqual(0);

  return editors.nth(matchingIndex);
};

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
  const sourceEvent = await database.query.eventInstances.findFirst({
    where: { id: target.id, tenantId: target.tenantId },
  });
  if (!sourceEvent) {
    throw new Error(
      'Seeded freeOpen event row was not found for event-management docs',
    );
  }

  await page.goto('.');
  await expect(page.getByRole('link', { name: 'Admin Tools' })).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Before you begin" %}
Use an account that can create events and manage all events.
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
- Status (draft, pending review, or published)
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
  ).toBeVisible({ timeout: 15_000 });

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
- **Review and listing actions**: Status, submit/review actions, edit link, and listing controls when your account has access
- **Organize this event**: A link to the organizer surface when you are allowed to organize the event

Let's look at each section in detail.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Registration Options

Registration options determine how people can sign up for your event. Templates can create one or more registration options that are then shown on the event details page.
Reusable add-ons copied from the template are shown separately on the event detail page with their price, purchase timing, quantity limits, and attached registration options.

Each draft event has its own registration configuration, independent of the template. **Simple** mode keeps exactly one organizing and one non-organizing option. **Advanced** mode supports any number of named options and lets you choose which registration options can use each reusable add-on, with separate included and optional quantities. Missing organizer or participant categories are warnings, not save blockers.

Every mode change asks for confirmation. Before returning an advanced event to simple mode, save the advanced setup with exactly one option of each kind, reopen the editor, and then confirm the separate mode change. Existing saved options and hidden add-ons are preserved.

When editing a draft event, registration options can include:

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
    (event) => event.id === seeded.scenario.events.draft.eventId,
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
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('event-mode-simple')).toBeVisible();
  await expect(page.getByTestId('event-mode-advanced')).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.getByLabel('Registration configuration mode'),
    page,
    'Event registration configuration modes',
  );
  const registrationOptionEditors = page.locator(
    'app-event-registration-option-editor',
  );
  const registrationOptionTitleInputs = registrationOptionEditors.getByRole(
    'textbox',
    { exact: true, name: 'Option name' },
  );
  let registrationOptionEditorIndex = -1;
  await expect
    .poll(
      async () => {
        const optionTitles = await registrationOptionTitleInputs.evaluateAll(
          (elements) =>
            elements.map((element) => {
              if (!(element instanceof HTMLInputElement)) {
                throw new Error('Expected an event option title input');
              }
              return element.value;
            }),
        );
        registrationOptionEditorIndex = optionTitles.indexOf(
          registrationOption.title,
        );
        return registrationOptionEditorIndex;
      },
      {
        message: `Expected event registration option "${registrationOption.title}"`,
        timeout: 15_000,
      },
    )
    .toBeGreaterThanOrEqual(0);
  const registrationOptionEditor = registrationOptionEditors.nth(
    registrationOptionEditorIndex,
  );
  await expect(
    registrationOptionEditor.getByRole('button', {
      name: `Remove ${selectedRole.name}`,
    }),
  ).toBeVisible({ timeout: 15_000 });
  const roleInput = registrationOptionEditor.getByPlaceholder('Add Role...');
  const roleListbox = page.getByRole('listbox', { name: 'Selected Roles' });
  const selectedRoleOption = roleListbox.getByRole('option', {
    exact: true,
    name: selectedRole.name,
  });
  const unselectedRoleOption = roleListbox.getByRole('option', {
    exact: true,
    name: unselectedRole.name,
  });

  await expect(async () => {
    await roleInput.fill(selectedRole.name);
    await expect(roleInput).toHaveValue(selectedRole.name);
    await expect(selectedRoleOption).toHaveCount(0);
  }).toPass({ timeout: 15_000 });

  await expect(async () => {
    await roleInput.fill(unselectedRole.name);
    await expect(roleInput).toHaveValue(unselectedRole.name);
    await expect(roleListbox).toBeVisible();
    await expect(unselectedRoleOption).toBeVisible();
  }).toPass({ timeout: 15_000 });
  await unselectedRoleOption.click();

  await expect(async () => {
    await roleInput.fill(unselectedRole.name);
    await expect(roleInput).toHaveValue(unselectedRole.name);
    await expect(unselectedRoleOption).toHaveCount(0);
  }).toPass({ timeout: 15_000 });
  await page.keyboard.press('Escape');

  await testInfo.attach('markdown', {
    body: `
Already selected roles are hidden from suggestions so the same eligibility role cannot be added twice.
`,
  });
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { name: draftEvent.title }).first(),
    page,
    'Event edit role picker duplicate prevention',
  );

  const editableEventId = getId();
  const editableParticipantOptionId = getId();
  const initialEditableTitle = `Disposable draft ${getId().slice(0, 6)}`;
  const savedEditableTitle = `${initialEditableTitle} updated`;
  const savedEditableDescription =
    'Meet beside the information desk fifteen minutes before departure.';
  const initialParticipantOptionTitle = 'Disposable participants';
  const savedParticipantOptionTitle = 'Participants with manual approval';
  const editableStart = DateTime.now().plus({ days: 28 }).startOf('hour');
  const editableEnd = editableStart.plus({ hours: 3 });

  await database.insert(eventInstances).values({
    creatorId: sourceEvent.creatorId,
    description: '<p>Disposable event before editing.</p>',
    end: editableEnd.toJSDate(),
    icon: sourceEvent.icon,
    id: editableEventId,
    simpleModeEnabled: true,
    start: editableStart.toJSDate(),
    status: 'DRAFT',
    templateId: sourceEvent.templateId,
    tenantId: target.tenantId,
    title: initialEditableTitle,
    unlisted: true,
  });

  try {
    await database.insert(eventRegistrationOptions).values([
      {
        closeRegistrationTime: editableStart.minus({ hours: 1 }).toJSDate(),
        description: 'Help run this disposable event.',
        eventId: editableEventId,
        isPaid: false,
        openRegistrationTime: editableStart.minus({ days: 7 }).toJSDate(),
        organizingRegistration: true,
        price: 0,
        registeredDescription: 'Organizer place confirmed.',
        registrationMode: 'fcfs',
        roleIds: [],
        spots: 4,
        title: 'Disposable organizers',
      },
      {
        closeRegistrationTime: editableStart.minus({ hours: 1 }).toJSDate(),
        description: 'Join this disposable event.',
        eventId: editableEventId,
        id: editableParticipantOptionId,
        isPaid: false,
        openRegistrationTime: editableStart.minus({ days: 7 }).toJSDate(),
        organizingRegistration: false,
        price: 0,
        registeredDescription: 'Participant place confirmed.',
        registrationMode: 'fcfs',
        roleIds: [],
        spots: 20,
        title: initialParticipantOptionTitle,
      },
    ]);

    await page.goto(`/events/${editableEventId}`);
    await expect(
      page.getByRole('heading', {
        exact: true,
        level: 1,
        name: initialEditableTitle,
      }),
    ).toBeVisible({ timeout: 20_000 });
    const openEditor = page.getByRole('link', {
      exact: true,
      name: 'Edit Event',
    });
    await expect(openEditor).toBeVisible();

    await testInfo.attach('markdown', {
      body: `
## Edit an existing draft event

Only **Draft** events can be changed with the normal event editor. Open the draft from **Events**, then select **Edit Event**. Pending-review and published events deliberately do not offer this action.

This walkthrough uses a disposable draft so every saved field can be read back without changing a shared event. It updates both general information and the event-owned registration configuration.
`,
    });

    await openEditor.click();
    await expect(page).toHaveURL(`/events/${editableEventId}/edit`);
    const eventDetailsEditor = page
      .getByRole('heading', { exact: true, name: 'Event details' })
      .locator('xpath=ancestor::section')
      .first();
    const editableTitle = eventDetailsEditor.getByLabel('Event title');
    await expect(editableTitle).toHaveValue(initialEditableTitle, {
      timeout: 20_000,
    });
    const descriptionEditor = eventDetailsEditor.locator('app-editor');
    const descriptionPlaceholder = descriptionEditor.getByTestId(
      'rich-editor-placeholder',
    );
    await expect(descriptionPlaceholder).not.toHaveAttribute(
      'jsaction',
      /click/u,
      { timeout: 20_000 },
    );

    await editableTitle.fill(savedEditableTitle);
    await descriptionPlaceholder.click();
    const descriptionContent = descriptionEditor.getByTestId(
      'rich-editor-content',
    );
    await expect(descriptionContent).toBeEditable({ timeout: 20_000 });
    await descriptionContent.fill(savedEditableDescription);

    const simpleModeButton = page.getByTestId('event-mode-simple');
    const advancedModeButton = page.getByTestId('event-mode-advanced');
    await expect(simpleModeButton).toHaveAttribute('aria-pressed', 'true');
    await advancedModeButton.click();
    const modeDialog = page.getByRole('dialog').filter({
      has: page.getByRole('heading', {
        exact: true,
        name: 'Change registration configuration?',
      }),
    });
    await expect(modeDialog).toContainText(
      'Advanced mode keeps both current options',
    );
    await expect(modeDialog).toContainText(
      'This change remains reversible until you save',
    );
    await takeScreenshot(
      testInfo,
      modeDialog,
      page,
      'Confirm a draft event registration mode change',
    );

    await modeDialog
      .getByRole('button', { exact: true, name: 'Keep current mode' })
      .click();
    await expect(simpleModeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(editableTitle).toHaveValue(savedEditableTitle);

    await testInfo.attach('markdown', {
      body: `
### Choose simple or advanced registration configuration

- **Simple** keeps exactly one organizer/helper option and one participant option. Use it when those two choices are enough.
- **Advanced** keeps the existing options but allows any number of named options and exposes add-ons.

Selecting a mode first opens a confirmation. Choose **Keep current mode** if you clicked by mistake or need to review the form; this closes the dialog without changing the mode or discarding the other unsaved fields. To return an advanced event to simple later, first reduce and save the advanced setup so it has exactly one organizer/helper and one participant option. Reopen the editor and confirm the separate mode change. Evorto does not silently delete extra options, questions, add-ons, or the registration options chosen for each add-on.
`,
    });

    await advancedModeButton.click();
    await page
      .getByRole('button', { exact: true, name: 'Use advanced mode' })
      .click();
    await expect(advancedModeButton).toHaveAttribute('aria-pressed', 'true');

    const participantEditor = await eventOptionEditorByTitle(
      page,
      initialParticipantOptionTitle,
    );
    await participantEditor
      .getByLabel('Option name')
      .fill(savedParticipantOptionTitle);
    await participantEditor.getByLabel('Capacity').fill('37');
    await participantEditor.getByLabel('Registration mode').click();
    await page
      .getByRole('option', { exact: true, name: 'Manual approval' })
      .click();
    await takeScreenshot(
      testInfo,
      participantEditor,
      page,
      'Edited draft event registration option',
    );

    await testInfo.attach('markdown', {
      body: `
### Update the draft and save it

Change the general event fields you need, such as **Event title** and **Description**. Registration configuration is saved with the same form. In this example, the participant option receives a clearer name, capacity **37**, and **Manual approval** mode.

Select **Save changes** once. A successful save returns to the event details page. If an error remains on the editor, the event has not been confirmed as updated: read the validation or error message, correct the problem, and select **Save changes** again. Do not assume an unsaved mode or registration change is live merely because it is visible in the form.
`,
    });

    const saveChanges = page.getByTestId('save-event-graph');
    await expect(saveChanges).toBeEnabled();
    await saveChanges.click();
    await expect(page).toHaveURL(`/events/${editableEventId}`, {
      timeout: 20_000,
    });
    await page.reload();
    await expect(
      page.getByRole('heading', {
        exact: true,
        level: 1,
        name: savedEditableTitle,
      }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(savedEditableDescription)).toBeVisible();

    const persistedEvent = await database.query.eventInstances.findFirst({
      where: { id: editableEventId, tenantId: target.tenantId },
    });
    const persistedParticipantOption =
      await database.query.eventRegistrationOptions.findFirst({
        where: {
          eventId: editableEventId,
          id: editableParticipantOptionId,
        },
      });
    expect(persistedEvent?.title).toBe(savedEditableTitle);
    expect(persistedEvent?.description).toContain(savedEditableDescription);
    expect(persistedEvent?.simpleModeEnabled).toBe(false);
    expect(persistedParticipantOption?.title).toBe(savedParticipantOptionTitle);
    expect(persistedParticipantOption?.spots).toBe(37);
    expect(persistedParticipantOption?.registrationMode).toBe('application');

    await page.getByRole('link', { exact: true, name: 'Edit Event' }).click();
    await expect(page).toHaveURL(`/events/${editableEventId}/edit`);
    await expect(page.getByLabel('Event title')).toHaveValue(
      savedEditableTitle,
      { timeout: 20_000 },
    );
    await expect(advancedModeButton).toHaveAttribute('aria-pressed', 'true');
    const reloadedParticipantEditor = await eventOptionEditorByTitle(
      page,
      savedParticipantOptionTitle,
    );
    await expect(reloadedParticipantEditor.getByLabel('Capacity')).toHaveValue(
      '37',
    );
    await expect(
      reloadedParticipantEditor.getByLabel('Registration mode'),
    ).toContainText('Manual approval');
    await takeScreenshot(
      testInfo,
      page.locator('app-event-edit'),
      page,
      'Reloaded draft event with saved changes',
    );

    await testInfo.attach('markdown', {
      body: `
### Confirm the saved result

Reload the event details page and check the new title and description. Open **Edit Event** again and verify that **Advanced**, the option name, capacity, and **Manual approval** selection are still present. This confirms that the saved event differs from any unsaved changes still in the browser.
`,
    });
  } finally {
    await database
      .delete(eventRegistrationOptions)
      .where(eq(eventRegistrationOptions.eventId, editableEventId));
    await database
      .delete(eventInstances)
      .where(eq(eventInstances.id, editableEventId));
  }

  await testInfo.attach('markdown', {
    body: `
## Event Status and Visibility

You can control how your event appears in the app with event status and listing visibility.

Event status values:

- **Draft**
- **Pending Review**
- **Published**

When a reviewer requests changes, the event returns to **Draft** and the
review feedback remains visible on its details page.

Listing visibility can be updated from the event actions menu.

For a full walkthrough of the review and approval lifecycle, see the dedicated Event Approval guide.
`,
  });

  // Take a screenshot of the event status section
  const statusChip = page.getByText(/Draft|Pending Review|Published/i).first();
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
Organizers can also cancel a participant's confirmed registration from the organizer overview before check-in, which releases the confirmed spot and submits the appropriate Stripe refunds for paid event and add-on payments. Event registration and add-on payments are Stripe-only; without a connected Stripe account for the organization, registration options and add-ons must remain free.
Organizers can transfer a participant registration directly to another eligible organization member only when the entire fixed bundle is free, requires no refund, and has no participant questions. When participant questions exist, the organizer creates a private transfer offer instead so the recipient can confirm current eligibility and provide their own current answers before ownership changes. Paid registrations also use the private transfer flow so the recipient can review the fixed bundle and pay the current base prices with only their own current discounts. Guest quantity, all included/free/purchased add-on quantities, and check-in/fulfillment history move unchanged. Existing check-in or add-on redemption does not erase that history or let the recipient omit fulfilled items. The previous owner receives exact refunds for every original Stripe payment; the organizer overview intentionally does not directly reassign a paid ticket.

It does not currently include attendee export, attendee messaging, or manual check-in controls outside QR scanning. Participant cancellation and private free or paid transfer are covered in the dedicated Registration Cancellation and Registration Transfer guides.
`,
  });

  let organizerOverviewFailureCount = 0;
  let receiptFailureCount = 0;
  const failOrganizerPageDataOnce = async (route: Route) => {
    const request = route.request();
    const requestBody = request.postData() ?? '';
    if (
      organizerOverviewFailureCount === 0 &&
      request.method() === 'POST' &&
      requestBody.includes('events.getOrganizeOverview')
    ) {
      organizerOverviewFailureCount += 1;
      await route.abort('failed');
      return;
    }
    if (
      receiptFailureCount === 0 &&
      request.method() === 'POST' &&
      requestBody.includes('finance.receipts.byEvent')
    ) {
      receiptFailureCount += 1;
      await route.abort('failed');
      return;
    }

    await route.fallback();
  };

  await page.route('**/rpc/**', failOrganizerPageDataOnce);
  await page.goto(`/events/${target.id}/organize`);
  const organizerLoadAlert = page.getByRole('alert').filter({
    hasText: 'Participant data could not be loaded',
  });
  const receiptLoadAlert = page.getByRole('alert').filter({
    hasText: 'Receipts could not be loaded',
  });
  const addReceiptButton = page.getByRole('button', { name: 'Add receipt' });
  await expect(organizerLoadAlert).toBeVisible({ timeout: 20_000 });
  await expect(receiptLoadAlert).toBeVisible({ timeout: 20_000 });
  expect(organizerOverviewFailureCount).toBe(1);
  expect(receiptFailureCount).toBe(1);
  await expect(organizerLoadAlert).toContainText(
    'Participant data could not be loaded',
  );
  await expect(organizerLoadAlert).toContainText(
    'Do not treat the missing counts as zero or as current event data.',
  );
  await expect(page.getByText('Registered', { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Cancel registration' }),
  ).toHaveCount(0);
  await expect(addReceiptButton).toBeDisabled();
  await expect(
    page.getByText('Receipt history must load before a receipt can be added.'),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-event-organize'),
    page,
    'Organizer overview explains unavailable participant data',
  );

  await testInfo.attach('markdown', {
    body: `
### Recover when participant data does not load

If the organizer overview request fails, Evorto hides every registration count and participant action. The warning explicitly says that missing counts are **not zero** and must not be treated as current event data.

1. Do not cancel, transfer, or approve a registration based on an empty-looking page.
2. Check that your network connection is available.
3. Select **Try again** in the warning.
4. Wait for the **Overview** and **Participant registrations** sections to return before continuing.

Receipt history has its own warning and **Try again** action. A receipt-loading warning means existing receipts may still be present; it is not a verified empty list. **Add receipt** stays unavailable until that history loads, preventing a duplicate submission based on incomplete information.
`,
  });

  await organizerLoadAlert.getByRole('button', { name: 'Try again' }).click();
  await expect(organizerLoadAlert).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId('event-organize-registered-stat'),
  ).toBeVisible();
  await expect(receiptLoadAlert).toContainText(
    'Existing receipt records may still be present.',
  );
  const verifiedNoReceipts = page.getByText(
    'No receipts submitted for this event yet.',
    { exact: true },
  );
  await expect(verifiedNoReceipts).toHaveCount(0);
  await receiptLoadAlert.getByRole('button', { name: 'Try again' }).click();
  await expect(receiptLoadAlert).toHaveCount(0);
  await expect(verifiedNoReceipts).toBeVisible();
  await expect(addReceiptButton).toBeEnabled();
  await page.unroute('**/rpc/**', failOrganizerPageDataOnce);

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
  const scannerUser = usersToAuthenticate.find(
    (user) => user.stateFile === emptyStateFile,
  );
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
    const confirmScannerCheckIn = await fillScannerGuestCheckInCount(page, {
      guestCount: 2,
      includeAttendee: true,
    });
    await takeScreenshot(
      testInfo,
      page.locator('app-handle-registration'),
      page,
      'Scanned registration with guest check-in',
    );
    await confirmScannerCheckIn.click();
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
      String(initialCheckedInSpots + 3),
      { timeout: 15_000 },
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

Draft events can be edited from the event details page when your account has access. An event returned by a reviewer is a draft, with the review feedback shown on the details page.
The edit form covers the same event details and registration setup used during event creation. Simple and advanced modes require confirmation; advanced setups may omit either option kind with a warning, and add-ons hidden by simple mode remain saved. Reducing an advanced setup and switching to simple are deliberately separate saves so no option is silently deleted or replaced.
Pending-review and published events are locked from normal editing.

## Current Scope

There is no general event settings tab in the current event UI.
Template categories are managed from the templates area, not from individual events.
Featured images, event tags, custom confirmation messages, notification settings, external integrations, and event deletion are not part of the current event management surface.
`,
  });
});
