import type { Locator, Page } from '@playwright/test';

import { and, eq, inArray } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { getId } from '../../../helpers/get-id';
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
  const inputs = editors.getByLabel('Registration option name', {
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
  const templateTitle = `Docs reusable template ${getId().slice(0, 6)}`;
  const planningTips = 'Bring the printed volunteer briefing checklist.';
  const addOnTitle = `Docs snack voucher ${getId().slice(0, 6)}`;
  const addOnDescription = 'Reusable snack add-on for docs coverage.';
  const questionTitle = `Docs accessibility needs ${getId().slice(0, 6)}`;
  const questionDescription = 'Tell organizers what support you need.';
  const eventTitle = `Docs event from template ${getId().slice(0, 6)}`;

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
{% callout type="note" title="User permissions" %}
For this guide, we assume you have an account with all required permissions. These are:
- **templates:create**: This permission is required to create a new template.
- **templates:editAll**: This permission is required to edit templates.
- **events:create**: This permission is required to create an event from the template.
{% /callout %}
Templates are the base for all events.
They are used to save common settings for events and have to be created before you can create an event.


## Creating templates
Start by navigating to **Templates**. Here you can see an overview of the existing templates.
Click on _Create template_ to create a new template.`,
  });
  await page.getByRole('link', { name: 'Templates' }).click();
  await takeScreenshot(
    testInfo,
    page.getByRole('link', { name: 'Create template' }),
    page,
  );
  await page.getByRole('link', { name: 'Create template' }).click();
  await testInfo.attach('markdown', {
    body: `
You can now specify all the settings for your template.
Everything you enter for a template will be the starting point for all events created from this template.
#### General settings
There are a few general settings that are required for templates:
- **Template icon**: The icon to be used for the template.
- **Template name**: The name of the template.
- **Template category**: The category this template should belong to. Learn how to [manage categories](/docs/manage-template-categories) to group your templates.
- **Template description**: Lastly, the description of the template. To open the full editor, click the field for the description.
- **Organizer planning tips**: Optional private organizer notes, setup checklists, or recurring reminders that stay on the template detail page and are not shown on the public event page.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-template-create form div').first(),
    page,
  );
  await testInfo.attach('markdown', {
    body: `
#### Registration settings
Simple mode is the default and splits registration settings in two.
There are the settings for participants, and separately, those for organizers.
Both have the same structure, but you can see that different roles are preselected.
Simple mode intentionally keeps exactly one organizer registration block and one participant registration block. Advanced configuration supports any number of named options and reveals reusable add-ons with explicit option mappings. Every mode change asks for confirmation. To return to simple mode, first save the advanced graph with exactly one organizing and one non-organizing option; switching modes never silently replaces option IDs.
The registration consists of the following settings:
- **Registration option name**: The reusable label copied into events created
  from this template.
- **Description** and **description for registered users**: Optional reusable
  public and attendee-only copy that is copied into the event registration
  option.
- **Payment required**: Is a payment required for this registration?
- **Registration fee**: The registration fee for this registration. This field is only visible if the payment is required.
- **ESNcard discounted price**: Optional discounted pricing for tenants with the ESNcard discount provider enabled. Leave it empty when this template registration should use the standard price only.
- **Selected roles**: The roles that are selected for this registration. Users can only see and use the registration if they have one of the selected roles.
- **Registration mode**: **First come, first served** confirms an eligible signup when capacity is available. **Manual approval** saves a pending application for an organizer to review; if the option is paid, payment starts only after approval and confirmation waits for successful payment.
- **Registration start**: The offset in hours for when the registration should start. For example 168 hours means that the registration will start 7 days before the event starts.
- **Registration end**: The offset in hours for when the registration should end. For example 24 hours means that the registration will end 1 day before the event starts.
- **Role picker behavior**: Roles that are already selected are hidden from autocomplete suggestions to prevent duplicates.
`,
  });
  await takeScreenshot(
    testInfo,
    page.locator('app-template-graph-editor'),
    page,
    'Simple registration configuration',
  );

  await testInfo.attach('markdown', {
    body: `
In the migrated form, payment-specific fields are conditionally shown.
When **Enable Payment** is on, the price and tax-rate fields appear for that registration block. Tenants with ESNcard discounts enabled also see the optional ESNcard discounted price field.
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
    organizerRegistrationForm
      .locator('mat-form-field')
      .filter({ hasText: 'Price (in cents)' })
      .locator('input[type="number"]')
      .first(),
  ).toBeVisible();
  await expect(
    organizerRegistrationForm
      .locator('mat-form-field')
      .filter({ hasText: 'Inclusive tax rate' })
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
Choose **Manual approval** when an organizer must review this category before confirming it. This works for participant and organizer/helper options. Applications do not reserve capacity or grant organizer access while pending.
`,
  });
  const organizerRegistrationMode = organizerRegistrationForm.getByRole(
    'combobox',
    { name: 'Registration mode' },
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
Role selection also avoids duplicate entries by hiding already selected roles from the autocomplete list.
`,
  });
  const organizerRoleInput = page.getByPlaceholder('Add Role...').first();
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
    'Role autocomplete hides selected entries',
  );
  await page.keyboard.press('Escape');

  await testInfo.attach('markdown', {
    body: `
#### Reusable add-ons
Templates can also store optional add-ons such as meals, equipment, or other extras.
Add-ons can be free or paid, mapped to one or more registration options, and can separately limit included units, optional purchases, total availability, and the maximum quantity per user.
When a template creates an event, those reusable add-ons are copied into the event and shown on matching registration cards for registration-time purchase.
`,
  });
  await page
    .getByRole('button', { name: 'Use advanced configuration' })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Switch to advanced configuration?',
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Switch to advanced', exact: true })
    .click();
  await page.getByRole('button', { name: 'Add add-on' }).click();
  const addOnEditor = page.locator('app-template-addon-editor').first();
  await expect(addOnEditor.getByLabel('Add-on name')).toBeVisible();
  await expect(
    addOnEditor.getByRole('combobox', {
      name: 'Registration option',
      exact: true,
    }),
  ).toBeVisible();
  await takeScreenshot(testInfo, addOnEditor, page, 'Reusable add-on mappings');

  await testInfo.attach('markdown', {
    body: `
#### Registration questions
Templates can store reusable registration questions for participant or organizer signup.
Questions can include help text and can be marked as required. Event-side answer collection is handled separately from this template setup flow.
`,
  });
  await page.getByRole('button', { name: 'Add question' }).click();
  const questionEditor = page.locator('app-template-question-editor').first();
  await expect(
    questionEditor.getByRole('textbox', { name: 'Question' }),
  ).toBeVisible();
  await expect(questionEditor.getByLabel('Ask during')).toBeVisible();
  await expect(page.getByText('Require an answer')).toBeVisible();
  await takeScreenshot(
    testInfo,
    questionEditor,
    page,
    'Reusable registration question form',
  );

  await testInfo.attach('markdown', {
    body: `
Once you are happy with your template, click _Save template_ to save your changes.
You will be redirected to the detail page for that template.
`,
  });
  const categorySelect = page.getByRole('combobox', {
    name: 'Template Category',
  });
  await categorySelect.focus();
  await page.keyboard.press('Enter');
  await page.getByRole('option', { name: category.title }).click();
  await fillTemplateBasics(page, {
    title: templateTitle,
  });
  await page.getByLabel('Organizer planning tips').fill(planningTips);
  await addOnEditor.getByLabel('Add-on name').fill(addOnTitle);
  await addOnEditor.getByLabel('Description').fill(addOnDescription);
  await addOnEditor
    .getByRole('combobox', { name: 'Registration option', exact: true })
    .click();
  await page
    .getByRole('option', { name: 'Participant registration', exact: true })
    .click();
  await addOnEditor.getByLabel('Included quantity').fill('2');
  await addOnEditor.getByLabel('Optional purchase quantity').fill('1');
  await addOnEditor.getByLabel('Available quantity').fill('8');
  await addOnEditor.getByLabel('Maximum per user').fill('3');
  await questionEditor
    .getByRole('textbox', { name: 'Question' })
    .fill(questionTitle);
  await questionEditor.getByLabel('Ask during').click();
  await page
    .getByRole('option', { name: 'Participant registration', exact: true })
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
  await expect(page.getByText(addOnTitle)).toBeVisible();
  await expect(page.getByText(questionTitle)).toBeVisible();

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
Open the template detail page and click **Create event**. The event form starts with the template title, description, and registration options. On save, the server atomically snapshots the template-owned mode, questions, add-ons, and mappings into event-owned rows. Later template edits never rewrite that event snapshot.

Dates use the fixed **de-DE** format. Enter times in the tenant's business timezone; Evorto preserves that meaning even when an organizer's browser is set to another timezone.

If **Event could not be created** appears, your entries remain in the form. Read the reason. For a temporary connection or server error, correct any affected field and click **Create event** again. If the reason says a registration option no longer belongs to the selected template, copy any unsaved entries you need, use **Back to template**, and start again from the latest template. If it mentions legacy random allocation, return to the template, change every option to **First come, first served** or **Manual approval**, save the template, and then start event creation again. A restarted form does not retain unsaved event entries. Do not assume the event exists until its detail page opens and shows the event title.
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
## Template and event independence
The event now owns its copied registration graph. Editing the source template changes future events only; the existing event keeps its option IDs, labels, add-on mappings, and quantities.
`,
  });
  await page.goto(`/templates/${createdTemplate.id}/edit`);
  const participantOptionEditor = await templateOptionEditorByTitle(
    page,
    'Participant registration',
  );
  const updatedParticipantTitle = 'Participant registration updated';
  await participantOptionEditor
    .getByLabel('Registration option name')
    .fill(updatedParticipantTitle);
  await page
    .locator('app-template-addon-editor')
    .filter({ hasText: addOnTitle })
    .getByLabel('Included quantity')
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
