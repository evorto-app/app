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
import { waitForRegistrationPage } from '../../support/utils/event-registration-page';
import { fillScannerGuestCheckInCount } from '../../support/utils/scanner-result-page';

test.use({ storageState: adminStateFile });
test.setTimeout(180_000);

const eventOptionEditorByTitle = async (
  page: Page,
  title: string,
): Promise<Locator> => {
  const editors = page.locator('app-event-registration-option-editor');
  const titleInputs = editors.getByRole('textbox', {
    exact: true,
    name: 'Sign-up choice name',
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
  testClock,
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


From **Events**, you can create and edit events, set up sign-up choices, manage attendees, publish events, and review event receipts.

## Event List

Start by navigating to the **Events** section from the main menu to see a list of all events.
`,
  });

  await page.getByRole('link', { name: 'Events' }).click();
  await expect(
    page.getByRole('heading', { level: 1, name: 'Events' }).first(),
  ).toBeVisible();
  await expect(page.locator('app-event-list nav a').first()).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { level: 1, name: 'Events' }).first(),
    page,
    'Published and draft events with dates and publishing stages',
  );

  await testInfo.attach('markdown', {
    body: `
The event list shows all events with their basic information:

- Event title
- Date and time
- Location
- Whether it is a draft, awaiting review, or published
- Who can find the event after it is published
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Create a new event

To create a new event, select **Create Event** on the event list page. This opens the templates page, where you can choose the structure for your new event.
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
    'Choose a template for the new event',
  );

  await testInfo.attach('markdown', {
    body: `
On the templates page, you can browse different event templates organized by category. Select a template that matches the type of event you want to create.

Once you've selected a template, you'll be able to customize it with your event details:

- Event title
- Event description
- Date and time
- Location
- Sign-up choices

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

After creating an event, Evorto opens its details page. It shows the event title, description, sign-up choices, publishing stage, and the organizer actions available to you.
`,
  });

  // Use a more specific selector that's guaranteed to be on the page
  await waitForRegistrationPage(page);
  await takeScreenshot(
    testInfo,
    page.locator(`h1:has-text("${target.title}")`).first(),
    page,
    'New event details and available organizer actions',
  );

  await testInfo.attach('markdown', {
    body: `
The event details page shows the information and actions you need:

- The top of the page shows the title, description, date, and location.
- **Your sign-up** shows available choices or your active ticket.
- The publishing status shows what happens next and offers review or editing actions when they are available.
- **Organize this event** opens organizer tools when you are allowed to run the event.
`,
  });

  await testInfo.attach('markdown', {
    body: `
## Sign-up choices

Sign-up choices determine how people can join your event. Templates can create one or more choices that are then shown on the event details page.
Reusable add-ons copied from the template are shown separately with their price, when they can be bought, quantity limits, and the choices that can use them.

Each draft event has its own sign-up setup, independent of the template. **Simple** keeps exactly one organizer choice and one attendee choice. **Advanced** supports any number of named choices and lets you choose which ones can use each reusable add-on, with separate included and optional quantities. The editor warns you when organizer or attendee choices are missing, but still lets you save.

Changing between **Simple** and **Advanced** asks for confirmation. Before returning an advanced event to simple setup, save it with exactly one choice of each kind, reopen the editor, and then confirm the setup change. Existing choices and hidden add-ons stay saved.

Each sign-up choice can include:

- Choice name
- Price (free or paid)
- When sign-up opens and closes
- Number of places
- Who can use the choice
- Whether the choice is for attendees or organizers/helpers

Set up the choices for your event and select **Save changes**.

Review the choices copied from the template and adjust them for this event.
`,
  });

  // Take a screenshot of the existing registration section.
  await expect(
    page.getByRole('heading', { level: 2, name: 'Your sign-up' }).first(),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { level: 2, name: 'Your sign-up' }).first(),
    page,
    'Sign-up choices on the event page',
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
    page.getByLabel('Sign-up setup'),
    page,
    'Simple and advanced sign-up setup',
  );
  const registrationOptionEditors = page.locator(
    'app-event-registration-option-editor',
  );
  const registrationOptionTitleInputs = registrationOptionEditors.getByRole(
    'textbox',
    { exact: true, name: 'Sign-up choice name' },
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
  const roleInput = registrationOptionEditor.getByPlaceholder('Add role…');
  const roleListbox = page.getByRole('listbox', { name: 'Selected roles' });
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
Already selected roles are not offered again.
`,
  });
  await takeScreenshot(
    testInfo,
    page.getByRole('heading', { name: draftEvent.title }).first(),
    page,
    'Choose which roles can use a sign-up choice',
  );

  const editableEventId = getId();
  const editableParticipantOptionId = getId();
  const initialEditableTitle = 'Volunteer planning session';
  const savedEditableTitle = `${initialEditableTitle} updated`;
  const savedEditableDescription =
    'Meet beside the information desk fifteen minutes before departure.';
  const initialParticipantOptionTitle = 'Planning attendees';
  const savedParticipantOptionTitle = 'Attendees with manual approval';
  const savedParticipantSpots = 30;
  const editableStart = DateTime.now().plus({ days: 28 }).startOf('hour');
  const editableEnd = editableStart.plus({ hours: 3 });

  await database.insert(eventInstances).values({
    creatorId: sourceEvent.creatorId,
    description: '<p>Meet at the information desk before departure.</p>',
    end: editableEnd.toJSDate(),
    icon: sourceEvent.icon,
    id: editableEventId,
    simpleModeEnabled: true,
    start: editableStart.toJSDate(),
    status: 'DRAFT',
    templateId: sourceEvent.templateId,
    tenantId: target.tenantId,
    title: initialEditableTitle,
  });

  try {
    await database.insert(eventRegistrationOptions).values([
      {
        closeRegistrationTime: editableStart.minus({ hours: 1 }).toJSDate(),
        description: 'Help run the planning session.',
        eventId: editableEventId,
        isPaid: false,
        openRegistrationTime: editableStart.minus({ days: 7 }).toJSDate(),
        organizingRegistration: true,
        price: 0,
        registeredDescription: 'Organizer place confirmed.',
        registrationMode: 'fcfs',
        roleIds: [],
        spots: 4,
        title: 'Planning helpers',
      },
      {
        closeRegistrationTime: editableStart.minus({ hours: 1 }).toJSDate(),
        description: 'Join the planning session.',
        eventId: editableEventId,
        id: editableParticipantOptionId,
        isPaid: false,
        openRegistrationTime: editableStart.minus({ days: 7 }).toJSDate(),
        organizingRegistration: false,
        price: 0,
        registeredDescription: 'Attendee place confirmed.',
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

Only **Draft** events can be changed. Open the draft from **Events**, then select **Edit Event**. Pending-review and published events deliberately do not offer this action.

Open a draft to change its general details and sign-up setup.
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
    const modeDialog = page
      .getByRole('dialog')
      .filter({
        has: page.getByRole('heading', {
          exact: true,
          name: 'Change sign-up setup?',
        }),
      })
      .last();
    await expect(modeDialog).toContainText(
      'Advanced setup keeps both current choices',
    );
    await expect(modeDialog).toContainText(
      'This change remains reversible until you save',
    );
    await takeScreenshot(
      testInfo,
      modeDialog,
      page,
      'Confirm a change to the draft event sign-up setup',
    );

    await modeDialog
      .getByRole('button', { exact: true, name: 'Keep current setup' })
      .click();
    await expect(modeDialog).toBeHidden();
    await expect(simpleModeButton).toHaveAttribute('aria-pressed', 'true');
    await expect(editableTitle).toHaveValue(savedEditableTitle);

    await testInfo.attach('markdown', {
      body: `
### Choose simple or advanced sign-up setup

- **Simple** keeps exactly one organizer/helper choice and one attendee choice. Use it when those two choices are enough.
- **Advanced** keeps the existing choices but allows any number of named choices and shows add-ons.

Selecting a setup first asks for confirmation. Choose **Keep current setup** if you selected it by mistake or need to check your entries; this closes the dialog without changing the setup or discarding other changes you have not saved. To return an advanced event to simple setup later, first reduce and save it so it has exactly one organizer/helper choice and one attendee choice. Reopen the editor and confirm the separate setup change. Evorto does not silently delete extra choices, questions, add-ons, or the choices selected for each add-on.
`,
    });

    await advancedModeButton.click();
    await expect(modeDialog).toBeVisible();
    await modeDialog
      .getByRole('button', { exact: true, name: 'Use advanced setup' })
      .click();
    await expect(advancedModeButton).toHaveAttribute('aria-pressed', 'true');

    const participantEditor = await eventOptionEditorByTitle(
      page,
      initialParticipantOptionTitle,
    );
    await participantEditor
      .getByLabel('Sign-up choice name')
      .fill(savedParticipantOptionTitle);
    await participantEditor
      .getByLabel('Number of places')
      .fill(savedParticipantSpots.toString());
    await participantEditor.getByLabel('How sign-ups are confirmed').click();
    await page
      .getByRole('option', { exact: true, name: 'Manual approval' })
      .click();
    await takeScreenshot(
      testInfo,
      participantEditor,
      page,
      'Edited draft event sign-up choice',
    );

    await testInfo.attach('markdown', {
      body: `
### Update the draft and save it

Change the general event fields you need, such as **Event title** and **Description**. The sign-up setup is saved with the same form. Set the choice name, number of places, and approval method for the event you are planning.

Select **Save changes** once. A successful save returns to the event details page. If an error remains on the editor, the event has not been updated: read the message, correct the problem, and select **Save changes** again. Changes are not saved just because they appear in the form.
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
    expect(persistedParticipantOption?.spots).toBe(savedParticipantSpots);
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
    await expect(
      reloadedParticipantEditor.getByLabel('Number of places'),
    ).toHaveValue(savedParticipantSpots.toString());
    await expect(
      reloadedParticipantEditor.getByLabel('How sign-ups are confirmed'),
    ).toContainText('Manual approval');
    await takeScreenshot(
      testInfo,
      page.locator('app-event-edit'),
      page,
      'Saved draft event with updated details',
    );

    await testInfo.attach('markdown', {
      body: `
### Confirm the saved result

After saving, the event details page shows the new title and description. Open **Edit Event** again to review the saved setup. Anything left unsaved in the form is not applied.
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
## Publishing and who can find an event

An event appears to members only after it is published. Who can find it is based on its current sign-up choices.

The publishing labels show what happens next:

- **Draft** means the event is still being prepared.
- **Pending Review** means it is waiting for an administrator.
- **Published** means the event is ready for members to find.

When a reviewer requests changes, the event returns to **Draft** and the
review feedback remains visible on its details page.

Sign-up events have no separate choice for who can find them. Signed-in members see an event when at least one sign-up choice is available to one of their roles. Before signing in, visitors may see events open to new members, but they must sign in before signing up. If a choice is no longer available before someone signs up, Evorto shows **Sign-up unavailable** and explains why. A signed-in member who follows a shared link without an available choice sees the same explanation.

Announcements without sign-up choices use a separate setting. **Choose who can find this announcement** selects the organization roles that should see it in **Events**. Without a selected role, it opens only from a shared link. This choice does not change anyone's role or access, or send a message. Announcements do not appear before sign-in.

For the full review and approval steps, see [Review and publish an event](/docs/review-and-publish-an-event).
`,
  });

  // Take a screenshot of the event status section
  const statusChip = page.getByText(/Draft|Pending Review|Published/i).first();
  try {
    await statusChip.waitFor({ state: 'visible', timeout: 2000 });
    await takeScreenshot(
      testInfo,
      statusChip,
      page,
      'Published event status and next actions',
    );
  } catch {
    // This view does not always show a separate publishing label.
  }

  await testInfo.attach('markdown', {
    body: `
## Organizer View

Once people start signing up for your event, organizers can open the **Organize this event** view from the event details page.

The organizer view currently includes:

- Available places overview
- Checked-in count
- Attendees grouped by sign-up choice
- ESNcard discount markers where applicable
- Add-ons bought by each attendee while signing up
- Event receipt submission and receipt list

Organizers check in attendees with the QR scanner. Attendees open their ticket QR code after their place is confirmed, and organizers scan it from **Scanner**. The result shows the attendee, event, sign-up choice, ESNcard discount when applicable, guest progress, and clear warnings when a ticket cannot be checked in.

Event organizers and members allowed to manage all events can check people in during the event's check-in period. The scanner explains when the event is still too far away. Confirming check-in updates the count shown on the organizer overview. When a ticket includes guests, the organizer chooses how many arrived with the attendee, and the count increases by the attendee plus those guests.
Organizers can also cancel an attendee's confirmed ticket from the organizer overview before check-in. This releases the place and starts any refund shown in the confirmation.

Attendee transfers always use a private offer from the current owner to one intended recipient. The recipient reviews the ticket, answers the current questions, and accepts it. A free transfer with no questions completes immediately after acceptance. When payment is required, the recipient pays before the ticket moves and Evorto then starts the previous owner's refund. Organizers can move the ticket directly only when the whole ticket is free, no refund is needed, and there are no attendee questions. Guest and add-on quantities cannot be changed. Existing attendee and guest check-ins and the history of handed-out add-ons move unchanged with the ticket.

It does not currently include downloading attendee lists, sending messages to attendees, or checking people in without scanning a QR code. See [Cancel a ticket](/docs/cancel-a-ticket) for attendee cancellation and [Transfer your ticket privately](/docs/transfer-your-ticket-privately) for private free or paid transfers.
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
    hasText: 'Attendees could not be loaded',
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
    'Attendees could not be loaded',
  );
  await expect(organizerLoadAlert).toContainText(
    'No current sign-up counts or attendee actions are shown. Select Try again.',
  );
  await expect(page.getByText('Signed up', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Cancel ticket' })).toHaveCount(
    0,
  );
  await expect(addReceiptButton).toBeDisabled();
  await expect(
    page.getByText('Receipt history must load before a receipt can be added.'),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    page.locator('app-event-organize'),
    page,
    'Attendees could not be loaded',
  );

  await testInfo.attach('markdown', {
    body: `
### When attendees do not load

If attendees cannot be loaded, Evorto hides every sign-up count and attendee action. Missing counts are **not zero** and must not be treated as up-to-date event information.

1. Do not cancel, transfer, or approve a ticket based on an empty-looking page.
2. Select **Try again** in the warning.
3. Wait for the **Overview** and **Attendee sign-ups** sections to return before continuing.

Receipt history has its own warning and **Try again** action. Until the history loads, Evorto cannot tell you whether receipts have already been submitted and keeps **Add receipt** unavailable. Select **Try again**, and wait for either the receipt list or **No receipts submitted for this event yet** before adding one.
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
    'No receipts are shown. Select Try again.',
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
        eq(eventRegistrationOptions.isPaid, false),
        eq(eventRegistrationOptions.organizingRegistration, false),
      ),
    )
    .limit(1);
  if (!scannerRegistrationOption) {
    throw new Error(
      'Expected seeded participant option for scanner documentation',
    );
  }
  if (scannerRegistrationOption.stripeTaxRateId !== null) {
    throw new Error(
      'Expected seeded free scanner registration option without a Stripe tax rate',
    );
  }
  const [scannerEventTiming] = await database
    .select({
      end: eventInstances.end,
      start: eventInstances.start,
    })
    .from(eventInstances)
    .where(
      and(
        eq(eventInstances.id, scannerEventId),
        eq(eventInstances.tenantId, seeded.tenant.id),
      ),
    )
    .limit(1);
  if (!scannerEventTiming) {
    throw new Error('Expected seeded event timing for scanner documentation');
  }
  const initialCheckedInSpots = scannerRegistrationOption.checkedInSpots;
  const initialConfirmedSpots = scannerRegistrationOption.confirmedSpots;
  const scannerRegistrationSpotCount = 3;
  const scannerConfirmedSpots =
    initialConfirmedSpots + scannerRegistrationSpotCount;
  if (
    scannerConfirmedSpots + scannerRegistrationOption.reservedSpots >
    scannerRegistrationOption.spots
  ) {
    throw new Error(
      'Expected enough seeded participant capacity for scanner documentation',
    );
  }
  const scannerUser = usersToAuthenticate.find(
    (user) => user.stateFile === emptyStateFile,
  );
  if (!scannerUser) {
    throw new Error('Expected regular user fixture for scanner documentation');
  }
  const scannerRegistrationId = getId();
  const scannerNow = testClock.toJSDate();

  try {
    const openedScannerEvents = await database
      .update(eventInstances)
      .set({
        end: new Date(scannerNow.getTime() + 30 * 60 * 1000),
        start: new Date(scannerNow.getTime() - 30 * 60 * 1000),
      })
      .where(
        and(
          eq(eventInstances.id, scannerEventId),
          eq(eventInstances.tenantId, seeded.tenant.id),
        ),
      )
      .returning({ id: eventInstances.id });
    if (openedScannerEvents.length !== 1) {
      throw new Error(
        'Expected to open the seeded event check-in window for scanner documentation',
      );
    }

    await database.transaction(async (transaction) => {
      const updatedOptions = await transaction
        .update(eventRegistrationOptions)
        .set({
          checkedInSpots: initialCheckedInSpots,
          confirmedSpots: scannerConfirmedSpots,
        })
        .where(
          and(
            eq(eventRegistrationOptions.eventId, scannerEventId),
            eq(eventRegistrationOptions.id, scannerRegistrationOption.id),
            eq(eventRegistrationOptions.checkedInSpots, initialCheckedInSpots),
            eq(eventRegistrationOptions.confirmedSpots, initialConfirmedSpots),
          ),
        )
        .returning({ id: eventRegistrationOptions.id });
      if (updatedOptions.length !== 1) {
        throw new Error(
          'Seeded participant counters changed before scanner documentation setup',
        );
      }

      await transaction.insert(eventRegistrations).values({
        appliedDiscountedPrice: null,
        appliedDiscountType: null,
        basePriceAtRegistration: scannerRegistrationOption.price,
        checkedInGuestCount: 0,
        discountAmount: 0,
        eventId: scannerEventId,
        guestCount: 2,
        id: scannerRegistrationId,
        registrationOptionId: scannerRegistrationOption.id,
        status: 'CONFIRMED',
        stripeTaxRateId: null,
        taxRateDisplayName: null,
        taxRateInclusive: null,
        taxRatePercentage: null,
        tenantId: seeded.tenant.id,
        userId: scannerUser.id,
      });
    });

    await page.goto(`/scan/registration/${scannerRegistrationId}`);
    await expect(
      page.getByRole('heading', { name: 'Ticket scanned' }),
    ).toBeVisible();
    await expect(page.getByText('Includes 2 guests.')).toBeVisible();
    await expect(page.getByText('0 checked in, 2 remaining.')).toBeVisible();
    await expect(
      page.getByText('Check-in closed', { exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText('Check-in not open', { exact: true }),
    ).toHaveCount(0);
    const confirmScannerCheckIn = await fillScannerGuestCheckInCount(page, {
      guestCount: 2,
      includeAttendee: true,
    });
    await takeScreenshot(
      testInfo,
      page.locator('app-handle-registration'),
      page,
      'Scanned ticket with guest check-in',
    );
    await confirmScannerCheckIn.click();
    await expect(page.getByText('Check-in complete')).toBeVisible();
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
            confirmedSpots: true,
          },
          where: { id: scannerRegistrationOption.id },
        });

        return {
          checkedIn: registration?.checkInTime !== null,
          checkedInGuestCount: registration?.checkedInGuestCount,
          checkedInSpots: option?.checkedInSpots,
          confirmedSpots: option?.confirmedSpots,
        };
      })
      .toEqual({
        checkedIn: true,
        checkedInGuestCount: 2,
        checkedInSpots: initialCheckedInSpots + 3,
        confirmedSpots: scannerConfirmedSpots,
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
          eq(eventRegistrationOptions.eventId, scannerEventId),
          eq(eventRegistrationOptions.id, scannerRegistrationOption.id),
        ),
      );
    await database
      .update(eventRegistrationOptions)
      .set({ confirmedSpots: initialConfirmedSpots })
      .where(
        and(
          eq(eventRegistrationOptions.eventId, scannerEventId),
          eq(eventRegistrationOptions.id, scannerRegistrationOption.id),
        ),
      );
    await database
      .update(eventInstances)
      .set(scannerEventTiming)
      .where(
        and(
          eq(eventInstances.id, scannerEventId),
          eq(eventInstances.tenantId, seeded.tenant.id),
        ),
      );
  }

  await testInfo.attach('markdown', {
    body: `

## Event Editing

Draft events can be edited from the event details page when your account has access. An event returned by a reviewer is a draft, with the review feedback shown on the details page.
The edit form covers the same event details and sign-up setup used during event creation. Changing between simple and advanced setup requires confirmation. Advanced setup may omit organizer or attendee choices with a warning, and add-ons hidden by simple setup remain saved. Reducing an advanced setup and switching to simple are separate saves so no choice is silently deleted or replaced.
Events waiting for review and published events cannot be edited here.

## Where to find related settings

Manage template categories from **Templates**, rather than from an individual event. Use the event details and editing pages for the event information and sign-up setup described above.
`,
  });
});
