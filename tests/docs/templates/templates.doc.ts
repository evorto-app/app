import { and, eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { getId } from '../../../helpers/get-id';
import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';
import { fillTemplateBasics } from '../../support/utils/template-form';

test.use({ storageState: adminStateFile });

test('Manage templates', async ({
  database,
  page,
  templateCategories,
  tenant,
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

  await page.goto('.');
  await testInfo.attach('markdown', {
    body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have an account with all required permissions. These are:
- **templates:create**: This permission is required to create a new template.
- **templates:editAll**: This permission is required to edit templates.
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
In simple mode (currently the only mode), the registration settings are split in two.
There are the settings for participants, and separately, those for organizers.
Both have the same structure, but you can see that different roles are preselected.
Simple mode intentionally keeps exactly one organizer registration block and one participant registration block. Use reusable add-ons, registration questions, option descriptions, role eligibility, and organizer planning tips to capture repeatable event knowledge that does not need a separate registration option.
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
- **Registration mode**: First come first serve is the only selectable mode for now. The first user to register will get the registration.
- **Registration start**: The offset in hours for when the registration should start. For example 168 hours means that the registration will start 7 days before the event starts.
- **Registration end**: The offset in hours for when the registration should end. For example 24 hours means that the registration will end 1 day before the event starts.
- **Role picker behavior**: Roles that are already selected are hidden from autocomplete suggestions to prevent duplicates.
`,
  });
  await takeScreenshot(
    testInfo,
    page
      .locator('app-template-create form')
      .locator('div', { hasText: 'Simple Registration Setup' }),
    page,
  );

  await testInfo.attach('markdown', {
    body: `
In the migrated form, payment-specific fields are conditionally shown.
When **Enable Payment** is on, the price and tax-rate fields appear for that registration block. Tenants with ESNcard discounts enabled also see the optional ESNcard discounted price field.
`,
  });
  const paymentToggle = page
    .locator('app-template-registration-option-form')
    .first()
    .getByRole('checkbox', { name: 'Enable payment' });
  await paymentToggle.check();
  const organizerRegistrationForm = page
    .locator('app-template-registration-option-form')
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
      .filter({ hasText: 'Tax rate' })
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
Add-ons can be free or paid, attached to either the participant or organizer registration option, and can limit the included quantity, total availability, maximum quantity per user, and purchase timing.
When a template creates an event, those reusable add-ons are copied into the event and shown on the event detail page. Registration-time add-ons are available from matching registration cards, while standalone before-event and during-event add-on sales are handled separately from this template setup flow.
`,
  });
  await page.getByRole('button', { name: 'Add add-on' }).click();
  const addOnForm = page.locator('app-template-addon-form').first();
  await expect(addOnForm.getByLabel('Add-on name')).toBeVisible();
  await expect(addOnForm.getByLabel('Attach to')).toBeVisible();
  await expect(page.getByText('Purchase timing')).toBeVisible();
  await takeScreenshot(testInfo, addOnForm, page, 'Reusable add-on form');

  await testInfo.attach('markdown', {
    body: `
#### Registration questions
Templates can store reusable registration questions for participant or organizer signup.
Questions can include help text and can be marked as required. Event-side answer collection is handled separately from this template setup flow.
`,
  });
  await page.getByRole('button', { name: 'Add question' }).click();
  const questionForm = page.locator('app-template-question-form').first();
  await expect(
    questionForm.getByRole('textbox', { name: 'Question' }),
  ).toBeVisible();
  await expect(questionForm.getByLabel('Ask during')).toBeVisible();
  await expect(page.getByText('Require an answer')).toBeVisible();
  await takeScreenshot(
    testInfo,
    questionForm,
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
  await addOnForm.getByLabel('Add-on name').fill(addOnTitle);
  await addOnForm.getByLabel('Description').fill(addOnDescription);
  await addOnForm.getByLabel('Included quantity').fill('2');
  await addOnForm.getByLabel('Available quantity').fill('8');
  await addOnForm.getByLabel('Max per user').fill('3');
  await questionForm
    .getByRole('textbox', { name: 'Question' })
    .fill(questionTitle);
  await questionForm.getByLabel('Help text').fill(questionDescription);
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page).toHaveURL(/\/templates\/[^/]+$/);
  await expect(
    page.getByRole('heading', { name: templateTitle }),
  ).toBeVisible();
  await expect(page.getByText(planningTips)).toBeVisible();
  await expect(page.getByText(addOnTitle)).toBeVisible();
  await expect(page.getByText(questionTitle)).toBeVisible();

  const createdTemplate = await database.query.eventTemplates.findFirst({
    where: {
      tenantId: tenant.id,
      title: templateTitle,
    },
  });
  if (!createdTemplate) {
    throw new Error('Expected template docs flow to persist the template');
  }
  expect(createdTemplate.planningTips).toBe(planningTips);

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
  expect(addOnAttachment.quantity).toBe(2);

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
Open the template detail page and click **Create event**. The event form starts with the template title, description, registration options, reusable add-ons, registration questions, and organizer planning tips already copied into the event draft.
`,
  });
  await page.getByRole('link', { name: 'Create event' }).click();
  await expect(page).toHaveURL(`/templates/${createdTemplate.id}/create-event`);
  await expect(page.getByLabel('Event title')).toHaveValue(templateTitle);
  await page.getByLabel('Event title').fill(eventTitle);

  const eventForm = page.locator('app-event-general-form');
  const futureStart = DateTime.now().plus({ months: 2 });
  await eventForm
    .getByRole('textbox', { name: 'Start date' })
    .fill(futureStart.toFormat('M/d/yyyy'));
  await eventForm.getByRole('combobox', { name: 'Start time' }).fill('1:00 PM');
  await eventForm
    .getByRole('textbox', { name: 'End date' })
    .fill(futureStart.toFormat('M/d/yyyy'));
  await eventForm.getByRole('combobox', { name: 'End time' }).fill('5:00 PM');
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
  const createdEventOptions =
    await database.query.eventRegistrationOptions.findMany({
      where: { eventId: createdEvent.id },
    });
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

  await database
    .delete(schema.eventRegistrationOptions)
    .where(eq(schema.eventRegistrationOptions.eventId, createdEvent.id));
  await database
    .delete(schema.eventInstances)
    .where(
      and(
        eq(schema.eventInstances.id, createdEvent.id),
        eq(schema.eventInstances.tenantId, tenant.id),
      ),
    );

  await database
    .delete(schema.addonToTemplateRegistrationOptions)
    .where(eq(schema.addonToTemplateRegistrationOptions.addonId, addOn.id));
  await database
    .delete(schema.templateRegistrationQuestions)
    .where(
      eq(schema.templateRegistrationQuestions.templateId, createdTemplate.id),
    );
  await database
    .delete(schema.templateEventAddons)
    .where(eq(schema.templateEventAddons.templateId, createdTemplate.id));
  await database
    .delete(schema.templateRegistrationOptions)
    .where(
      eq(schema.templateRegistrationOptions.templateId, createdTemplate.id),
    );
  await database
    .delete(schema.eventTemplates)
    .where(
      and(
        eq(schema.eventTemplates.id, createdTemplate.id),
        eq(schema.eventTemplates.tenantId, tenant.id),
      ),
    );
});
