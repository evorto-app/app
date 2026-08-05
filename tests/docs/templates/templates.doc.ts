import type { Locator, Page } from '@playwright/test';

import { and, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { fillTemplateBasics } from '../../support/utils/template-form';

const templateOptionEditorByTitle = async (
  page: Page,
  title: string,
): Promise<Locator> => {
  const editors = page.locator('app-template-registration-option-editor');
  const inputs = editors.getByLabel('Sign-up choice name', {
    exact: true,
  });
  let matchingIndex = -1;

  await expect
    .poll(
      async () => {
        const inputValues = await inputs.evaluateAll((elements) =>
          elements.map((element) => {
            if (!(element instanceof HTMLInputElement)) {
              throw new Error('Expected a template registration option input');
            }
            return element.value;
          }),
        );
        matchingIndex = inputValues.indexOf(title);
        return matchingIndex;
      },
      {
        message: `Expected template registration option "${title}"`,
        timeout: 15_000,
      },
    )
    .toBeGreaterThanOrEqual(0);

  return editors.nth(matchingIndex);
};

test.use({
  storageState: adminStateFile,
  timezoneId: 'America/Los_Angeles',
});

test('Manage templates', async ({
  database,
  registerDatabaseCleanup,
  page,
  templateCategories,
  tenant,
  testClock,
}, testInfo) => {
  const category = templateCategories[0];
  if (!category) {
    throw new Error('Expected seeded template category for template docs');
  }
  const templateTitle = 'Volunteer welcome evening';
  const planningTips = 'Bring the printed volunteer briefing checklist.';
  const addOnTitle = 'Snack voucher';
  const addOnDescription = 'A snack voucher available during the event.';
  const questionTitle = 'Accessibility needs';
  const questionDescription = 'Tell organizers what support you need.';
  const eventTitle = 'Volunteer welcome event';

  registerDatabaseCleanup(async (cleanupDatabase) => {
    const createdEvents = await cleanupDatabase
      .select({ id: schema.eventInstances.id })
      .from(schema.eventInstances)
      .where(
        and(
          eq(schema.eventInstances.tenantId, tenant.id),
          eq(schema.eventInstances.title, eventTitle),
        ),
      );
    const eventIds = createdEvents.map((event) => event.id);
    if (eventIds.length > 0) {
      const copiedOptions = await cleanupDatabase
        .select({ id: schema.eventRegistrationOptions.id })
        .from(schema.eventRegistrationOptions)
        .where(inArray(schema.eventRegistrationOptions.eventId, eventIds));
      const copiedOptionIds = copiedOptions.map((option) => option.id);
      if (copiedOptionIds.length > 0) {
        await cleanupDatabase
          .delete(schema.eventRegistrationOptionDiscounts)
          .where(
            inArray(
              schema.eventRegistrationOptionDiscounts.registrationOptionId,
              copiedOptionIds,
            ),
          );
      }
      await cleanupDatabase
        .delete(schema.eventRegistrationQuestions)
        .where(inArray(schema.eventRegistrationQuestions.eventId, eventIds));
      await cleanupDatabase
        .delete(schema.addonToEventRegistrationOptions)
        .where(
          inArray(schema.addonToEventRegistrationOptions.eventId, eventIds),
        );
      await cleanupDatabase
        .delete(schema.eventAddons)
        .where(inArray(schema.eventAddons.eventId, eventIds));
      await cleanupDatabase
        .delete(schema.eventRegistrationOptions)
        .where(inArray(schema.eventRegistrationOptions.eventId, eventIds));
      await cleanupDatabase
        .delete(schema.eventInstances)
        .where(
          and(
            eq(schema.eventInstances.tenantId, tenant.id),
            inArray(schema.eventInstances.id, eventIds),
          ),
        );
    }

    const createdTemplates = await cleanupDatabase
      .select({ id: schema.eventTemplates.id })
      .from(schema.eventTemplates)
      .where(
        and(
          eq(schema.eventTemplates.tenantId, tenant.id),
          eq(schema.eventTemplates.title, templateTitle),
        ),
      );
    const templateIds = createdTemplates.map((template) => template.id);
    if (templateIds.length === 0) {
      return;
    }
    const templateOptions = await cleanupDatabase
      .select({ id: schema.templateRegistrationOptions.id })
      .from(schema.templateRegistrationOptions)
      .where(
        inArray(schema.templateRegistrationOptions.templateId, templateIds),
      );
    const templateOptionIds = templateOptions.map((option) => option.id);
    if (templateOptionIds.length > 0) {
      await cleanupDatabase
        .delete(schema.templateRegistrationOptionDiscounts)
        .where(
          inArray(
            schema.templateRegistrationOptionDiscounts.registrationOptionId,
            templateOptionIds,
          ),
        );
    }
    await cleanupDatabase
      .delete(schema.templateRegistrationQuestions)
      .where(
        inArray(schema.templateRegistrationQuestions.templateId, templateIds),
      );
    await cleanupDatabase
      .delete(schema.addonToTemplateRegistrationOptions)
      .where(
        inArray(
          schema.addonToTemplateRegistrationOptions.templateId,
          templateIds,
        ),
      );
    await cleanupDatabase
      .delete(schema.templateEventAddons)
      .where(inArray(schema.templateEventAddons.templateId, templateIds));
    await cleanupDatabase
      .delete(schema.templateRegistrationOptions)
      .where(
        inArray(schema.templateRegistrationOptions.templateId, templateIds),
      );
    await cleanupDatabase
      .delete(schema.eventTemplates)
      .where(
        and(
          eq(schema.eventTemplates.tenantId, tenant.id),
          inArray(schema.eventTemplates.id, templateIds),
        ),
      );
  });

  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="Who can do this" %}
You need **View templates** plus **Create templates** to create templates, **Edit all templates** to edit them, and **Create events** to create an event from a template.
{% /callout %}
Templates are reusable starting points for events. To create an event, choose the template whose structure you want to start with.


## Creating templates
Start by navigating to **Templates**. Here you can see an overview of the existing templates.
Select **Create template** to create a new template.`,
  });
  await page.getByRole('link', { name: 'Templates' }).click();
  await takeScreenshot(
    testInfo,
    page.getByRole('link', { name: 'Create template' }),
    page,
    'Event templates page with the Create template action',
  );
  await page.getByRole('link', { name: 'Create template' }).click();
  await testInfo.attach('markdown', {
    body: `
You can now specify all the settings for your template.
The template's event details, sign-up choices, questions, and add-ons become the starting point for new events. Template-only fields such as its category and organizer planning tips are not copied.
### General settings
There are a few general settings that are required for templates:
- **Template icon**: The icon to be used for the template.
- **Template title**: The title of the template.
- **Template category**: The category this template should belong to. Learn how to [manage categories](/docs/manage-template-categories) to group your templates.
- **Template description**: The description of the template. To open the full editor, select the description field.
- **Organizer planning tips**: Optional private organizer notes, setup checklists, or recurring reminders that stay on the template detail page and are not shown on the public event page.

Templates provide the starting details for new events. They do not decide who can find an event. After publication, an event appears to members who can use one of its sign-up choices. Choose who can see an announcement on the announcement itself.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-template-create form div').first(),
    page,
    'Template general settings',
  );
  await testInfo.attach('markdown', {
    body: `
### Sign-up setup
Simple setup starts with one choice for attendees and one for organizers or helpers. Both have the same fields, but different roles are selected for each.
Advanced setup supports any number of named choices and lets you choose which choices can use each reusable add-on. Switching between simple and advanced setup asks for confirmation. To return to simple setup, first save exactly one organizer choice and one attendee choice. Switching setups never replaces saved choices without confirmation.
If paid sign-ups are not ready, prices must remain zero. An administrator with **Manage payments** access can open **Admin Tools** → **Payments** to review readiness. If the page still says paid sign-ups are not ready, contact Evorto support.
Each sign-up choice includes:
- **Sign-up choice name**: The label copied into events created from this template.
- **Description** and **Details shown after sign-up**: Optional information shown before and after someone signs up, copied into the event.
- **Enable payment**: Adds a price to this choice.
- **Price**: The amount each person pays. It appears only when payment is enabled.
- **ESNcard price**: An optional lower price for organizations that offer an ESNcard discount. Leave it empty to use the standard price.
- **Who can use this choice**: The organization roles allowed to choose it.
- **How sign-ups are confirmed**: **First come, first served** confirms a sign-up when space is available. **Manual approval** lets an organizer review it first. If payment is required, the person pays after approval.
- **Sign-up opens**: Enter how long before the event sign-up begins in **Days** and **Hours**; for example, 7 days and 0 hours.
- **Sign-up closes**: Enter how long before the event sign-up closes in **Days** and **Hours**; for example, 1 day and 0 hours.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-template-graph-editor'),
    page,
    'Simple sign-up setup',
  );

  await testInfo.attach('markdown', {
    body: `
When **Enable payment** is on, the price and tax-rate fields appear for that sign-up choice. Organizations with ESNcard discounts enabled also see the optional ESNcard price field.
`,
  });
  const paymentToggle = page
    .locator('app-template-registration-option-editor')
    .first()
    .getByRole('checkbox', { name: 'Enable payment' });
  await paymentToggle.check();
  const organizerRegistrationForm = page
    .locator('app-template-registration-option-editor')
    .first();
  await expect(
    organizerRegistrationForm.getByLabel(/^Price \([A-Z]{3}\)$/),
  ).toBeVisible();
  await expect(
    organizerRegistrationForm
      .locator('mat-form-field')
      .filter({ hasText: 'Tax included in the shown price' })
      .locator('mat-select')
      .first(),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    organizerRegistrationForm,
    page,
    'Organizer payment fields visible',
  );
  await paymentToggle.click();

  await testInfo.attach('markdown', {
    body: `
Choose **Manual approval** when an organizer must review this choice before confirming it. This works for attendee and organizer/helper choices. Applications do not reserve a place or allow someone to organize the event while waiting for review.
`,
  });
  const organizerRegistrationMode = organizerRegistrationForm.getByRole(
    'combobox',
    { name: 'How sign-ups are confirmed' },
  );
  await organizerRegistrationMode.click();
  await page
    .getByRole('option', { exact: true, name: 'Manual approval' })
    .click();
  await expect(organizerRegistrationMode).toContainText('Manual approval');
  await takeScreenshot(
    testInfo,
    organizerRegistrationForm,
    page,
    'Manual approval organizer option',
  );

  await testInfo.attach('markdown', {
    body: `
Already selected roles are not offered again.
`,
  });
  const organizerRoleInput = page.getByPlaceholder('Add role…').first();
  await organizerRoleInput.fill('a');
  const roleOptions = page.locator('mat-option');
  await expect(roleOptions.first()).toBeVisible();

  const firstRoleOption = roleOptions.first();
  const firstRoleText = await firstRoleOption.textContent();
  const selectedRoleName = firstRoleText?.trim();
  if (!selectedRoleName) {
    throw new Error('Expected template docs autocomplete option to have text');
  }
  await firstRoleOption.click();
  await organizerRoleInput.fill(selectedRoleName);
  await expect(
    page.getByRole('option', {
      exact: true,
      name: selectedRoleName,
    }),
  ).toHaveCount(0);
  await takeScreenshot(
    testInfo,
    organizerRegistrationForm,
    page,
    'Selected roles are not offered twice',
  );
  await page.keyboard.press('Escape');

  await testInfo.attach('markdown', {
    body: `
### Reusable add-ons
Templates can also store optional add-ons such as meals, equipment, or other extras.
Add-ons can be free or paid and available with one or more sign-up choices. For each sign-up choice, set how many items are included and how many additional items each person may buy. You can also set the total available quantity and the maximum each person can receive.
When a template creates an event, those reusable add-ons are copied into the event and shown with the matching sign-up choices.
`,
  });
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Use advanced setup', exact: true })
    .click();
  const advancedSetupDialog = page.getByRole('dialog', {
    name: 'Switch to advanced setup?',
  });
  await expect(advancedSetupDialog).toBeVisible();
  await advancedSetupDialog
    .getByRole('button', { name: 'Use advanced setup', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add add-on' }).click();
  const addOnEditor = page.locator('app-template-addon-editor').first();
  await expect(addOnEditor.getByLabel('Add-on name')).toBeVisible();
  await expect(
    addOnEditor.getByRole('combobox', {
      name: 'Sign-up choice',
      exact: true,
    }),
  ).toBeVisible();
  await takeScreenshot(
    testInfo,
    addOnEditor,
    page,
    'Sign-up choices for reusable add-ons',
  );

  await testInfo.attach('markdown', {
    body: `
### Sign-up questions
Templates can store questions for attendees, organizers, or helpers.
Questions can include help text and can be marked as required. Choose the sign-up choice that should show each question and use **Question order** to control which question appears first.
`,
  });
  await page.getByRole('button', { name: 'Add question' }).click();
  const questionEditor = page.locator('app-template-question-editor').first();
  await expect(
    questionEditor.getByRole('textbox', { name: 'Question' }),
  ).toBeVisible();
  await expect(questionEditor.getByLabel('Ask during')).toBeVisible();
  await expect(questionEditor.getByLabel('Question order')).toBeVisible();
  await expect(page.getByText('Require an answer')).toBeVisible();
  await takeScreenshot(
    testInfo,
    questionEditor,
    page,
    'Reusable sign-up question form',
  );

  await testInfo.attach('markdown', {
    body: `
Once you are happy with your template, select **Save template** to save your changes.
Evorto opens the template details page.
`,
  });
  const categorySelect = page.getByRole('combobox', {
    name: 'Template Category',
  });
  await categorySelect.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: category.title }).click();
  await fillTemplateBasics(page, {
    description: 'A welcoming evening for new volunteers.',
    title: templateTitle,
  });
  await page.getByLabel('Organizer planning tips').fill(planningTips);
  await addOnEditor.getByLabel('Add-on name').fill(addOnTitle);
  await addOnEditor.getByLabel('Description').fill(addOnDescription);
  await addOnEditor
    .getByRole('combobox', { name: 'Sign-up choice', exact: true })
    .click();
  await page
    .getByRole('option', { name: 'Attendee sign-up', exact: true })
    .click();
  await addOnEditor.getByLabel('Included items').fill('2');
  await addOnEditor.getByLabel('Items people can buy').fill('1');
  await addOnEditor.getByLabel('Items available').fill('8');
  await addOnEditor.getByLabel('Maximum each person can get').fill('3');
  await questionEditor
    .getByRole('textbox', { name: 'Question' })
    .fill(questionTitle);
  await questionEditor.getByLabel('Ask during').click();
  await page
    .getByRole('option', { name: 'Attendee sign-up', exact: true })
    .click();
  await questionEditor.getByLabel('Help text').fill(questionDescription);
  await questionEditor
    .getByRole('checkbox', { name: 'Require an answer' })
    .check();
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page).toHaveURL(/\/templates\/(?!create(?:\/|$))[^/]+$/, {
    timeout: 15_000,
  });
  await expect(
    page.getByRole('heading', { name: templateTitle }),
  ).toBeVisible();
  await expect(page.getByText(planningTips)).toBeVisible();
  await expect(
    page.getByRole('heading', { exact: true, name: addOnTitle }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { exact: true, name: questionTitle }),
  ).toBeVisible();

  let createdTemplate: typeof schema.eventTemplates.$inferSelect | undefined;
  await expect(async () => {
    const template = await database.query.eventTemplates.findFirst({
      where: {
        tenantId: tenant.id,
        title: templateTitle,
      },
    });
    if (!template) {
      throw new Error('Expected template docs flow to persist the template');
    }
    createdTemplate = template;
    expect(createdTemplate.planningTips).toBe(planningTips);
  }).toPass({
    intervals: [250, 500, 1_000],
    timeout: 15_000,
  });
  if (!createdTemplate) {
    throw new Error('Expected template docs flow to persist the template');
  }

  const registrationOptions =
    await database.query.templateRegistrationOptions.findMany({
      where: { templateId: createdTemplate.id },
    });
  const participantRegistrationOption = registrationOptions.find(
    (option) => !option.organizingRegistration,
  );
  if (!participantRegistrationOption) {
    throw new Error(
      'Expected template docs flow to persist a participant registration option',
    );
  }
  const organizerRegistrationOption = registrationOptions.find(
    (option) => option.organizingRegistration,
  );
  if (!organizerRegistrationOption) {
    throw new Error(
      'Expected template docs flow to persist an organizer registration option',
    );
  }
  expect(organizerRegistrationOption.registrationMode).toBe('application');

  const addOn = await database.query.templateEventAddons.findFirst({
    where: {
      templateId: createdTemplate.id,
      title: addOnTitle,
    },
  });
  if (!addOn) {
    throw new Error(
      'Expected template docs flow to persist the reusable add-on',
    );
  }
  expect(addOn).toEqual(
    expect.objectContaining({
      description: addOnDescription,
      isPaid: false,
      maxQuantityPerUser: 3,
      totalAvailableQuantity: 8,
    }),
  );

  const addOnAttachment =
    await database.query.addonToTemplateRegistrationOptions.findFirst({
      where: {
        addonId: addOn.id,
        registrationOptionId: participantRegistrationOption.id,
      },
    });
  if (!addOnAttachment) {
    throw new Error(
      'Expected template docs flow to persist the add-on registration option attachment',
    );
  }
  expect(addOnAttachment).toEqual(
    expect.objectContaining({
      includedQuantity: 2,
      optionalPurchaseQuantity: 1,
    }),
  );

  const question = await database.query.templateRegistrationQuestions.findFirst(
    {
      where: {
        registrationOptionId: participantRegistrationOption.id,
        templateId: createdTemplate.id,
        title: questionTitle,
      },
    },
  );
  if (!question) {
    throw new Error(
      'Expected template docs flow to persist the registration question',
    );
  }
  expect(question).toEqual(
    expect.objectContaining({
      description: questionDescription,
      required: true,
    }),
  );

  await testInfo.attach('markdown', {
    body: `
## Creating an event from a template
Open the template detail page and select **Create event**. The event form starts with the template title, description, and sign-up choices. When you select **Create event**, Evorto copies the sign-up setup, questions, and add-ons into the new event. Later template changes do not alter events already created from it. After publication, the event appears to members who can use one of its sign-up choices.

Enter dates in day.month.year format and use the time shown for the organization. The event keeps that time even when an organizer opens it from somewhere with a different local time.

If **Event could not be created** appears, your entries remain in the form. Read the reason and correct any highlighted field before trying again. If the template changed while the form was open, copy any unsaved text you need, use **Back to template**, and start again from the latest template. The event has been created only when its details page opens and shows the event title.
`,
  });
  await page.getByRole('link', { name: 'Create event' }).click();
  await expect(page).toHaveURL(`/templates/${createdTemplate.id}/create-event`);
  await expect(page.getByLabel('Event title')).toHaveValue(templateTitle, {
    timeout: 20_000,
  });
  await page.getByLabel('Event title').fill(eventTitle);

  const eventForm = page.locator('app-event-general-form');
  const futureStart = testClock.plus({ months: 2 });
  await eventForm
    .getByRole('textbox', { name: 'Start date' })
    .fill(futureStart.setLocale('de-DE').toLocaleString(DateTime.DATE_SHORT));
  await eventForm.getByRole('combobox', { name: 'Start time' }).fill('13:00');
  await eventForm
    .getByRole('textbox', { name: 'End date' })
    .fill(futureStart.setLocale('de-DE').toLocaleString(DateTime.DATE_SHORT));
  await eventForm.getByRole('combobox', { name: 'End time' }).fill('17:00');
  await takeScreenshot(
    testInfo,
    eventForm,
    page,
    'Event created from template',
  );

  await page.getByRole('button', { name: 'Create event' }).click();
  await page.waitForURL(/\/events\//, { timeout: 20_000 });
  await expect(
    page.getByRole('heading', { name: eventTitle }).last(),
  ).toBeVisible();

  const createdEvent = await database.query.eventInstances.findFirst({
    where: {
      templateId: createdTemplate.id,
      tenantId: tenant.id,
      title: eventTitle,
    },
  });
  if (!createdEvent) {
    throw new Error(
      'Expected template docs flow to persist an event from the template',
    );
  }
  const createdEventTenant = await database.query.tenants.findFirst({
    where: { id: tenant.id },
  });
  if (!createdEventTenant) {
    throw new Error('Expected template docs tenant runtime settings');
  }
  const tenantStart = DateTime.fromObject(
    {
      day: futureStart.day,
      hour: 13,
      month: futureStart.month,
      year: futureStart.year,
    },
    { zone: createdEventTenant.timezone },
  );
  expect(createdEvent.start.toISOString()).toBe(
    tenantStart.toJSDate().toISOString(),
  );
  expect(createdEvent.end.toISOString()).toBe(
    tenantStart.plus({ hours: 4 }).toJSDate().toISOString(),
  );
  const createdEventOptions =
    await database.query.eventRegistrationOptions.findMany({
      where: { eventId: createdEvent.id },
    });
  expect(createdEvent.simpleModeEnabled).toBe(false);
  expect(createdEventOptions.length).toBe(registrationOptions.length);

  const createdEventAddOn = await database.query.eventAddons.findFirst({
    where: {
      eventId: createdEvent.id,
      title: addOnTitle,
    },
  });
  if (!createdEventAddOn) {
    throw new Error(
      'Expected template docs flow to copy reusable add-ons into the event',
    );
  }
  const createdEventQuestion =
    await database.query.eventRegistrationQuestions.findFirst({
      where: {
        eventId: createdEvent.id,
        title: questionTitle,
      },
    });
  if (!createdEventQuestion) {
    throw new Error(
      'Expected template docs flow to copy registration questions into the event',
    );
  }
  const createdEventMappings =
    await database.query.addonToEventRegistrationOptions.findMany({
      where: { addonId: createdEventAddOn.id, eventId: createdEvent.id },
    });
  expect(createdEventMappings).toEqual([
    expect.objectContaining({
      includedQuantity: 2,
      optionalPurchaseQuantity: 1,
    }),
  ]);

  const eventOptionSnapshot = createdEventOptions
    .map((option) => ({ id: option.id, title: option.title }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const eventMappingSnapshot = createdEventMappings
    .map((mapping) => ({
      includedQuantity: mapping.includedQuantity,
      optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
      registrationOptionId: mapping.registrationOptionId,
    }))
    .sort((left, right) =>
      left.registrationOptionId.localeCompare(right.registrationOptionId),
    );

  await testInfo.attach('markdown', {
    body: `
## Later template changes do not change this event
The event now has its own copy of the sign-up setup. Editing the template changes future events only; the existing event keeps its saved choices, labels, add-on availability, and quantities.
`,
  });
  await page.goto(`/templates/${createdTemplate.id}/edit`);
  const editTemplateForm = page.locator('app-template-edit form');
  // SSR exposes the controlled fields before Angular attaches the live submit
  // listener. Wait for event replay to hand the form to the hydrated app so a
  // subsequent model initialization cannot restore the server-rendered values.
  await expect(editTemplateForm).not.toHaveAttribute('jsaction', /submit/, {
    timeout: 20_000,
  });
  const participantOptionEditor = await templateOptionEditorByTitle(
    page,
    'Attendee sign-up',
  );
  const updatedParticipantTitle = 'Updated attendee sign-up';
  const participantTitleInput = participantOptionEditor.getByLabel(
    'Sign-up choice name',
  );
  await participantTitleInput.fill(updatedParticipantTitle);
  await expect(participantTitleInput).toHaveValue(updatedParticipantTitle);
  await page
    .locator('app-template-addon-editor')
    .filter({ hasText: addOnTitle })
    .getByLabel('Included items')
    .fill('3');
  await page.getByTestId('save-template-graph').click();
  await expect(page).toHaveURL(`/templates/${createdTemplate.id}`, {
    timeout: 15_000,
  });

  const editedParticipantOption =
    await database.query.templateRegistrationOptions.findFirst({
      where: { id: participantRegistrationOption.id },
    });
  const eventOptionsAfterTemplateEdit =
    await database.query.eventRegistrationOptions.findMany({
      where: { eventId: createdEvent.id },
    });
  const eventMappingsAfterTemplateEdit =
    await database.query.addonToEventRegistrationOptions.findMany({
      where: { addonId: createdEventAddOn.id, eventId: createdEvent.id },
    });
  expect(editedParticipantOption?.title).toBe(updatedParticipantTitle);
  expect(
    eventOptionsAfterTemplateEdit
      .map((option) => ({ id: option.id, title: option.title }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  ).toEqual(eventOptionSnapshot);
  expect(
    eventMappingsAfterTemplateEdit
      .map((mapping) => ({
        includedQuantity: mapping.includedQuantity,
        optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
        registrationOptionId: mapping.registrationOptionId,
      }))
      .sort((left, right) =>
        left.registrationOptionId.localeCompare(right.registrationOptionId),
      ),
  ).toEqual(eventMappingSnapshot);
});
