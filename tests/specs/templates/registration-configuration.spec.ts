import type { Locator, Page } from '@playwright/test';

import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';

import { getId } from '../../../helpers/get-id';
import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: adminStateFile });

const addEditor = async (
  page: Page,
  buttonName: string,
  selector: string,
): Promise<Locator> => {
  const editors = page.locator(selector);
  const previousCount = await editors.count();
  await page.getByRole('button', { name: buttonName, exact: true }).click();
  await expect(editors).toHaveCount(previousCount + 1);
  return editors.nth(previousCount);
};

const templateOptionEditorByTitle = async (
  page: Page,
  title: string,
): Promise<Locator> => {
  const editors = page.locator('app-template-registration-option-editor');
  for (let index = 0; index < (await editors.count()); index += 1) {
    const editor = editors.nth(index);
    if (
      (await editor.getByLabel('Registration option name').inputValue()) ===
      title
    ) {
      return editor;
    }
  }
  throw new Error(`Expected template registration option "${title}"`);
};

const eventOptionEditorByTitle = async (
  page: Page,
  title: string,
): Promise<Locator> => {
  const editors = page.locator('app-event-registration-option-editor');
  for (let index = 0; index < (await editors.count()); index += 1) {
    const editor = editors.nth(index);
    if ((await editor.getByLabel('Option name').inputValue()) === title) {
      return editor;
    }
  }
  throw new Error(`Expected event registration option "${title}"`);
};

const confirmTemplateMode = async (
  page: Page,
  mode: 'advanced' | 'simple',
): Promise<void> => {
  await page
    .getByRole('button', {
      name: `Use ${mode} configuration`,
    })
    .click();
  await expect(
    page.getByRole('heading', {
      name: `Switch to ${mode} configuration?`,
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: `Switch to ${mode}`, exact: true })
    .click();
  await expect(
    page.getByRole('button', {
      name: `Use ${mode} configuration`,
    }),
  ).toHaveAttribute('aria-pressed', 'true');
};

const confirmEventMode = async (
  page: Page,
  mode: 'advanced' | 'simple',
): Promise<void> => {
  await page.getByTestId(`event-mode-${mode}`).click();
  await expect(
    page.getByRole('heading', {
      name: 'Change registration configuration?',
    }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: `Use ${mode} mode`, exact: true })
    .click();
  await expect(page.getByTestId(`event-mode-${mode}`)).toHaveAttribute(
    'aria-pressed',
    'true',
  );
};

const fillEventDates = async (page: Page, start: DateTime): Promise<void> => {
  const eventForm = page.locator('app-event-general-form');
  const date = start.setLocale('de-DE').toLocaleString(DateTime.DATE_SHORT);
  await eventForm.getByRole('textbox', { name: 'Start date' }).fill(date);
  await eventForm.getByRole('combobox', { name: 'Start time' }).fill('13:00');
  await eventForm.getByRole('textbox', { name: 'End date' }).fill(date);
  await eventForm.getByRole('combobox', { name: 'End time' }).fill('17:00');
};

test('tenant template graph confirms mode changes, warns without blocking, and preserves mappings when returning to simple', async ({
  database,
  page,
  templates,
}) => {
  const template = templates.find(
    (candidate) => candidate.seedKey === 'city-tour',
  );
  if (!template) {
    throw new Error('Expected a seeded city-tour template');
  }

  const initialOptions =
    await database.query.templateRegistrationOptions.findMany({
      where: { templateId: template.id },
    });
  const initialOrganizer = initialOptions.find(
    (option) => option.organizingRegistration,
  );
  const initialParticipant = initialOptions.find(
    (option) => !option.organizingRegistration,
  );
  if (!initialOrganizer || !initialParticipant || initialOptions.length !== 2) {
    throw new Error(
      'Expected the seeded template to start with one organizer and one participant option',
    );
  }

  await page.goto(`/templates/${template.id}/edit`);
  await expect(
    page.getByRole('button', { name: 'Use simple configuration' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page
    .getByRole('button', { name: 'Use advanced configuration' })
    .click();
  await expect(
    page.getByRole('heading', {
      name: 'Switch to advanced configuration?',
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Keep current mode' }).click();
  await expect(
    page.getByRole('button', { name: 'Use simple configuration' }),
  ).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('template-addons-section')).toHaveCount(0);

  await confirmTemplateMode(page, 'advanced');
  await expect(page.getByTestId('template-addons-section')).toBeVisible();

  const addedOptionTitle = `Volunteers ${getId().slice(0, 6)}`;
  const addedOptionEditor = await addEditor(
    page,
    'Add registration option',
    'app-template-registration-option-editor',
  );
  await addedOptionEditor
    .getByLabel('Registration option name')
    .fill(addedOptionTitle);

  const organizerEditor = await templateOptionEditorByTitle(
    page,
    initialOrganizer.title,
  );
  await organizerEditor
    .getByRole('checkbox', { name: 'Organizing option' })
    .uncheck();
  await expect(page.getByTestId('template-graph-warning')).toContainText(
    'No organizing option is configured.',
  );

  const addOnTitle = `Template equipment ${getId().slice(0, 6)}`;
  const addOnEditor = await addEditor(
    page,
    'Add add-on',
    'app-template-addon-editor',
  );
  await addOnEditor.getByLabel('Add-on name').fill(addOnTitle);
  await addOnEditor.getByLabel('Available quantity').fill('12');
  await addOnEditor.getByLabel('Maximum per user').fill('3');
  await addOnEditor.getByLabel('Included quantity').fill('2');
  await addOnEditor.getByLabel('Optional purchase quantity').fill('1');
  await addOnEditor.getByRole('button', { name: 'Add mapping' }).click();
  await addOnEditor.getByLabel('Included quantity').nth(1).fill('0');
  await addOnEditor.getByLabel('Optional purchase quantity').nth(1).fill('3');

  const questionTitle = `Accessibility ${getId().slice(0, 6)}`;
  const questionEditor = await addEditor(
    page,
    'Add question',
    'app-template-question-editor',
  );
  await questionEditor
    .getByRole('textbox', { name: 'Question', exact: true })
    .fill(questionTitle);

  const saveTemplate = page.getByTestId('save-template-graph');
  await expect(saveTemplate).toBeEnabled();
  await saveTemplate.click();
  await expect(page).toHaveURL(`/templates/${template.id}`);

  const advancedTemplate = await database.query.eventTemplates.findFirst({
    where: { id: template.id },
  });
  const advancedOptions =
    await database.query.templateRegistrationOptions.findMany({
      where: { templateId: template.id },
    });
  expect(advancedTemplate?.simpleModeEnabled).toBe(false);
  expect(advancedOptions).toHaveLength(3);
  expect(
    advancedOptions.every((option) => !option.organizingRegistration),
  ).toBe(true);

  const savedAddOn = await database.query.templateEventAddons.findFirst({
    where: { templateId: template.id, title: addOnTitle },
  });
  if (!savedAddOn) {
    throw new Error('Expected the advanced template add-on to persist');
  }
  const savedMappings =
    await database.query.addonToTemplateRegistrationOptions.findMany({
      where: { addonId: savedAddOn.id },
    });
  expect(
    savedMappings
      .map(({ includedQuantity, optionalPurchaseQuantity }) => ({
        includedQuantity,
        optionalPurchaseQuantity,
      }))
      .sort((left, right) => left.includedQuantity - right.includedQuantity),
  ).toEqual([
    { includedQuantity: 0, optionalPurchaseQuantity: 3 },
    { includedQuantity: 2, optionalPurchaseQuantity: 1 },
  ]);
  const savedQuestion =
    await database.query.templateRegistrationQuestions.findFirst({
      where: { templateId: template.id, title: questionTitle },
    });
  if (!savedQuestion) {
    throw new Error('Expected the advanced template question to persist');
  }

  const advancedOptionIds = advancedOptions.map((option) => option.id).sort();
  const mappingSnapshot = savedMappings
    .map((mapping) => ({
      includedQuantity: mapping.includedQuantity,
      optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
      registrationOptionId: mapping.registrationOptionId,
    }))
    .sort((left, right) =>
      left.registrationOptionId.localeCompare(right.registrationOptionId),
    );

  await page.goto(`/templates/${template.id}/edit`);
  await page.getByRole('button', { name: 'Use simple configuration' }).click();
  await expect(page.getByTestId('template-graph-mode-error')).toContainText(
    'Simple configuration requires exactly one organizing and one non-organizing option.',
  );
  await expect(
    page.getByRole('heading', { name: 'Switch to simple configuration?' }),
  ).toHaveCount(0);

  const reloadedOrganizer = await templateOptionEditorByTitle(
    page,
    initialOrganizer.title,
  );
  await reloadedOrganizer
    .getByRole('checkbox', { name: 'Organizing option' })
    .check();
  const reloadedAddedOption = await templateOptionEditorByTitle(
    page,
    addedOptionTitle,
  );
  await reloadedAddedOption
    .getByRole('button', { name: 'Remove option' })
    .click();

  await page.getByTestId('save-template-graph').click();
  await expect(page).toHaveURL(`/templates/${template.id}`);
  const compatibleAdvancedTemplate =
    await database.query.eventTemplates.findFirst({
      where: { id: template.id },
    });
  const compatibleAdvancedOptions =
    await database.query.templateRegistrationOptions.findMany({
      where: { templateId: template.id },
    });
  expect(compatibleAdvancedTemplate?.simpleModeEnabled).toBe(false);
  expect(compatibleAdvancedOptions.map((option) => option.id).sort()).toEqual(
    [initialOrganizer.id, initialParticipant.id].sort(),
  );

  await page.goto(`/templates/${template.id}/edit`);
  await confirmTemplateMode(page, 'simple');
  await expect(page.getByTestId('template-addons-section')).toHaveCount(0);
  await page.getByTestId('save-template-graph').click();
  await expect(page).toHaveURL(`/templates/${template.id}`);

  const simpleTemplate = await database.query.eventTemplates.findFirst({
    where: { id: template.id },
  });
  const simpleOptions =
    await database.query.templateRegistrationOptions.findMany({
      where: { templateId: template.id },
    });
  const preservedAddOn = await database.query.templateEventAddons.findFirst({
    where: { id: savedAddOn.id },
  });
  const preservedMappings =
    await database.query.addonToTemplateRegistrationOptions.findMany({
      where: { addonId: savedAddOn.id },
    });
  const preservedQuestion =
    await database.query.templateRegistrationQuestions.findFirst({
      where: { id: savedQuestion.id },
    });

  expect(simpleTemplate?.simpleModeEnabled).toBe(true);
  expect(simpleOptions.map((option) => option.id).sort()).toEqual(
    advancedOptionIds.filter(
      (id) => id === initialOrganizer.id || id === initialParticipant.id,
    ),
  );
  expect(preservedAddOn?.id).toBe(savedAddOn.id);
  expect(
    preservedMappings
      .map((mapping) => ({
        includedQuantity: mapping.includedQuantity,
        optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
        registrationOptionId: mapping.registrationOptionId,
      }))
      .sort((left, right) =>
        left.registrationOptionId.localeCompare(right.registrationOptionId),
      ),
  ).toEqual(mappingSnapshot);
  expect(preservedQuestion?.id).toBe(savedQuestion.id);
});

test('draft event graph supports arbitrary options and preserves hidden add-ons when returning to simple', async ({
  database,
  events,
  page,
}) => {
  const event = events.find(
    (candidate) =>
      candidate.status === 'DRAFT' &&
      candidate.registrationOptions.length === 2,
  );
  if (!event) {
    throw new Error('Expected a seeded draft event with two options');
  }
  const initialOrganizer = event.registrationOptions.find(
    (option) => option.organizingRegistration,
  );
  const initialParticipant = event.registrationOptions.find(
    (option) => !option.organizingRegistration,
  );
  if (!initialOrganizer || !initialParticipant) {
    throw new Error(
      'Expected the seeded draft event to have organizer and participant options',
    );
  }

  await page.goto(`/events/${event.id}/edit`);
  await confirmEventMode(page, 'advanced');
  await expect(page.getByTestId('event-addons-section')).toBeVisible();

  const addedOptionTitle = `Event helpers ${getId().slice(0, 6)}`;
  const addedOptionEditor = await addEditor(
    page,
    'Add registration option',
    'app-event-registration-option-editor',
  );
  const addedOptionName = addedOptionEditor.getByLabel('Option name');
  await expect(addedOptionName).toHaveValue('New registration option');
  await addedOptionName.fill(addedOptionTitle);
  const organizerEditor = await eventOptionEditorByTitle(
    page,
    initialOrganizer.title,
  );
  await organizerEditor
    .getByRole('checkbox', { name: 'Organizing or helper option' })
    .uncheck();
  await expect(page.getByTestId('event-graph-warning')).toContainText(
    'No organizing registration option is configured.',
  );

  const addOnTitle = `Event equipment ${getId().slice(0, 6)}`;
  const addOnEditor = await addEditor(
    page,
    'Add add-on',
    'app-event-addon-editor',
  );
  await addOnEditor.getByLabel('Add-on name').fill(addOnTitle);
  await addOnEditor.getByLabel('Total stock').fill('12');
  await addOnEditor.getByLabel('Maximum optional units per user').fill('3');
  await addOnEditor.getByLabel('Included quantity').fill('2');
  await addOnEditor.getByLabel('Optional quantity').fill('1');
  await addOnEditor.getByRole('button', { name: 'Map another option' }).click();
  await addOnEditor.getByLabel('Included quantity').nth(1).fill('0');
  await addOnEditor.getByLabel('Optional quantity').nth(1).fill('3');

  const saveEvent = page.getByTestId('save-event-graph');
  await expect(saveEvent).toBeEnabled();
  await saveEvent.click();
  await expect(page).toHaveURL(`/events/${event.id}`);

  const advancedEvent = await database.query.eventInstances.findFirst({
    where: { id: event.id },
  });
  const advancedOptions =
    await database.query.eventRegistrationOptions.findMany({
      where: { eventId: event.id },
    });
  const savedAddOn = await database.query.eventAddons.findFirst({
    where: { eventId: event.id, title: addOnTitle },
  });
  if (!savedAddOn) {
    throw new Error('Expected the event add-on to persist');
  }
  const savedMappings =
    await database.query.addonToEventRegistrationOptions.findMany({
      where: { addonId: savedAddOn.id, eventId: event.id },
    });
  expect(advancedEvent?.simpleModeEnabled).toBe(false);
  expect(advancedOptions).toHaveLength(3);
  expect(
    advancedOptions.every((option) => !option.organizingRegistration),
  ).toBe(true);
  expect(
    savedMappings
      .map(({ includedQuantity, optionalPurchaseQuantity }) => ({
        includedQuantity,
        optionalPurchaseQuantity,
      }))
      .sort((left, right) => left.includedQuantity - right.includedQuantity),
  ).toEqual([
    { includedQuantity: 0, optionalPurchaseQuantity: 3 },
    { includedQuantity: 2, optionalPurchaseQuantity: 1 },
  ]);

  const mappingSnapshot = savedMappings
    .map((mapping) => ({
      includedQuantity: mapping.includedQuantity,
      optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
      registrationOptionId: mapping.registrationOptionId,
    }))
    .sort((left, right) =>
      left.registrationOptionId.localeCompare(right.registrationOptionId),
    );

  await page.goto(`/events/${event.id}/edit`);
  await page.getByTestId('event-mode-simple').click();
  await expect(page.getByRole('alert')).toContainText(
    'Simple mode requires exactly one organizing and one non-organizing registration option.',
  );
  await expect(
    page.getByRole('heading', {
      name: 'Change registration configuration?',
    }),
  ).toHaveCount(0);

  const reloadedOrganizer = await eventOptionEditorByTitle(
    page,
    initialOrganizer.title,
  );
  await reloadedOrganizer
    .getByRole('checkbox', { name: 'Organizing or helper option' })
    .check();
  const reloadedAddedOption = await eventOptionEditorByTitle(
    page,
    addedOptionTitle,
  );
  await reloadedAddedOption
    .getByRole('button', { name: 'Remove option' })
    .click();

  await page.getByTestId('save-event-graph').click();
  await expect(page).toHaveURL(`/events/${event.id}`);
  const compatibleAdvancedEvent = await database.query.eventInstances.findFirst(
    {
      where: { id: event.id },
    },
  );
  const compatibleAdvancedOptions =
    await database.query.eventRegistrationOptions.findMany({
      where: { eventId: event.id },
    });
  expect(compatibleAdvancedEvent?.simpleModeEnabled).toBe(false);
  expect(compatibleAdvancedOptions.map((option) => option.id).sort()).toEqual(
    [initialOrganizer.id, initialParticipant.id].sort(),
  );

  await page.goto(`/events/${event.id}/edit`);
  await confirmEventMode(page, 'simple');
  await expect(page.getByTestId('event-addons-section')).toHaveCount(0);
  await page.getByTestId('save-event-graph').click();
  await expect(page).toHaveURL(`/events/${event.id}`);

  const simpleEvent = await database.query.eventInstances.findFirst({
    where: { id: event.id },
  });
  const simpleOptions = await database.query.eventRegistrationOptions.findMany({
    where: { eventId: event.id },
  });
  const preservedAddOn = await database.query.eventAddons.findFirst({
    where: { id: savedAddOn.id },
  });
  const preservedMappings =
    await database.query.addonToEventRegistrationOptions.findMany({
      where: { addonId: savedAddOn.id, eventId: event.id },
    });

  expect(simpleEvent?.simpleModeEnabled).toBe(true);
  expect(simpleOptions.map((option) => option.id).sort()).toEqual(
    [initialOrganizer.id, initialParticipant.id].sort(),
  );
  expect(preservedAddOn?.id).toBe(savedAddOn.id);
  expect(
    preservedMappings
      .map((mapping) => ({
        includedQuantity: mapping.includedQuantity,
        optionalPurchaseQuantity: mapping.optionalPurchaseQuantity,
        registrationOptionId: mapping.registrationOptionId,
      }))
      .sort((left, right) =>
        left.registrationOptionId.localeCompare(right.registrationOptionId),
      ),
  ).toEqual(mappingSnapshot);
});

test('event creation snapshots an advanced template before later page-backed template edits', async ({
  database,
  page,
  roles,
  templates,
  testClock,
}) => {
  const template = templates.find(
    (candidate) => candidate.seedKey === 'city-trip',
  );
  const participantRole = roles.find((role) => role.defaultUserRole);
  if (!template || !participantRole) {
    throw new Error(
      'Expected a seeded city-trip template and participant role',
    );
  }
  const sourceOptions =
    await database.query.templateRegistrationOptions.findMany({
      where: { templateId: template.id },
    });
  if (sourceOptions.length !== 2) {
    throw new Error('Expected the source template to start with two options');
  }

  const extraOptionId = getId();
  const extraOptionTitle = `Alumni ${getId().slice(0, 6)}`;
  const sourceAddOnId = getId();
  const sourceAddOnTitle = `Snapshot kit ${getId().slice(0, 6)}`;
  const sourceQuestionTitle = `Snapshot note ${getId().slice(0, 6)}`;
  const firstSourceOption = sourceOptions[0];
  if (!firstSourceOption) {
    throw new Error('Expected a source registration option');
  }

  await database
    .update(schema.eventTemplates)
    .set({ simpleModeEnabled: false })
    .where(eq(schema.eventTemplates.id, template.id));
  await database.insert(schema.templateRegistrationOptions).values({
    closeRegistrationOffset: 1,
    id: extraOptionId,
    isPaid: false,
    openRegistrationOffset: 168,
    organizingRegistration: false,
    price: 0,
    registrationMode: 'fcfs',
    roleIds: [participantRole.id],
    spots: 12,
    templateId: template.id,
    title: extraOptionTitle,
  });
  await database.insert(schema.templateEventAddons).values({
    allowMultiple: true,
    allowPurchaseBeforeEvent: false,
    allowPurchaseDuringEvent: false,
    allowPurchaseDuringRegistration: true,
    id: sourceAddOnId,
    isPaid: false,
    maxQuantityPerUser: 3,
    price: 0,
    templateId: template.id,
    title: sourceAddOnTitle,
    totalAvailableQuantity: 20,
  });
  await database.insert(schema.addonToTemplateRegistrationOptions).values([
    {
      addonId: sourceAddOnId,
      includedQuantity: 2,
      optionalPurchaseQuantity: 1,
      registrationOptionId: firstSourceOption.id,
      templateId: template.id,
    },
    {
      addonId: sourceAddOnId,
      includedQuantity: 0,
      optionalPurchaseQuantity: 3,
      registrationOptionId: extraOptionId,
      templateId: template.id,
    },
  ]);
  await database.insert(schema.templateRegistrationQuestions).values({
    registrationOptionId: extraOptionId,
    required: true,
    sortOrder: 0,
    templateId: template.id,
    title: sourceQuestionTitle,
  });

  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await page.getByRole('link', { name: template.title }).click();
  await page.getByRole('link', { name: 'Create event' }).click();
  await expect(page).toHaveURL(`/templates/${template.id}/create-event`);

  const eventTitle = `Independent snapshot ${getId().slice(0, 6)}`;
  await page.getByLabel('Event title').fill(eventTitle);
  await fillEventDates(page, testClock.plus({ months: 2 }));
  await page.getByRole('button', { name: 'Create event' }).click();
  await page.waitForURL(/\/events\/[a-z0-9]+$/, { timeout: 20_000 });

  const createdEvent = await database.query.eventInstances.findFirst({
    where: { tenantId: template.tenantId, title: eventTitle },
  });
  if (!createdEvent) {
    throw new Error('Expected the page flow to create an event');
  }
  const eventOptionsBeforeTemplateEdit =
    await database.query.eventRegistrationOptions.findMany({
      where: { eventId: createdEvent.id },
    });
  const eventAddOn = await database.query.eventAddons.findFirst({
    where: { eventId: createdEvent.id, title: sourceAddOnTitle },
  });
  const eventQuestion =
    await database.query.eventRegistrationQuestions.findFirst({
      where: { eventId: createdEvent.id, title: sourceQuestionTitle },
    });
  if (!eventAddOn || !eventQuestion) {
    throw new Error('Expected the complete template graph to be snapshotted');
  }
  const eventMappingsBeforeTemplateEdit =
    await database.query.addonToEventRegistrationOptions.findMany({
      where: { addonId: eventAddOn.id, eventId: createdEvent.id },
    });
  expect(createdEvent.simpleModeEnabled).toBe(false);
  expect(
    eventOptionsBeforeTemplateEdit.map((option) => option.title).sort(),
  ).toEqual(
    [...sourceOptions.map((option) => option.title), extraOptionTitle].sort(),
  );
  expect(eventMappingsBeforeTemplateEdit).toHaveLength(2);

  const sourceTitleBeforeEdit = firstSourceOption.title;
  const changedSourceTitle = `${sourceTitleBeforeEdit} updated`;
  await page.goto(`/templates/${template.id}/edit`);
  const sourceOptionEditor = await templateOptionEditorByTitle(
    page,
    sourceTitleBeforeEdit,
  );
  await sourceOptionEditor
    .getByLabel('Registration option name')
    .fill(changedSourceTitle);
  const sourceAddOnEditor = page
    .locator('app-template-addon-editor')
    .filter({ hasText: sourceAddOnTitle });
  await sourceAddOnEditor.getByLabel('Included quantity').first().fill('4');
  await page.getByTestId('save-template-graph').click();
  await expect(page).toHaveURL(`/templates/${template.id}`);

  const editedTemplateOption =
    await database.query.templateRegistrationOptions.findFirst({
      where: { id: firstSourceOption.id, templateId: template.id },
    });
  const editedTemplateMapping =
    await database.query.addonToTemplateRegistrationOptions.findFirst({
      where: {
        addonId: sourceAddOnId,
        registrationOptionId: firstSourceOption.id,
      },
    });
  const eventAfterTemplateEdit = await database.query.eventInstances.findFirst({
    where: { id: createdEvent.id },
  });
  const eventOptionsAfterTemplateEdit =
    await database.query.eventRegistrationOptions.findMany({
      where: { eventId: createdEvent.id },
    });
  const eventMappingsAfterTemplateEdit =
    await database.query.addonToEventRegistrationOptions.findMany({
      where: { addonId: eventAddOn.id, eventId: createdEvent.id },
    });

  expect(editedTemplateOption?.title).toBe(changedSourceTitle);
  expect(editedTemplateMapping?.includedQuantity).toBe(4);
  expect(eventAfterTemplateEdit?.simpleModeEnabled).toBe(false);
  expect(eventOptionsAfterTemplateEdit).toEqual(eventOptionsBeforeTemplateEdit);
  expect(eventMappingsAfterTemplateEdit).toEqual(
    eventMappingsBeforeTemplateEdit,
  );
});

test('legacy random template and event graphs are explicit read-only blocks', async ({
  database,
  events,
  page,
  templates,
}) => {
  const template = templates[0];
  const draftEvent = events.find(
    (candidate) =>
      candidate.status === 'DRAFT' && candidate.registrationOptions.length > 0,
  );
  if (!template || !draftEvent) {
    throw new Error('Expected seeded template and draft event fixtures');
  }
  const templateOption =
    await database.query.templateRegistrationOptions.findFirst({
      where: { templateId: template.id },
    });
  const eventOption = await database.query.eventRegistrationOptions.findFirst({
    where: { eventId: draftEvent.id },
  });
  if (!templateOption || !eventOption) {
    throw new Error('Expected seeded registration options');
  }

  await database
    .update(schema.templateRegistrationOptions)
    .set({ registrationMode: 'random' })
    .where(eq(schema.templateRegistrationOptions.id, templateOption.id));
  await page.goto(`/templates/${template.id}/edit`);
  await expect(page.getByTestId('template-graph-readonly')).toContainText(
    'random allocation',
  );
  await expect(page.getByTestId('save-template-graph')).toHaveCount(0);

  await database
    .update(schema.eventRegistrationOptions)
    .set({ registrationMode: 'random' })
    .where(eq(schema.eventRegistrationOptions.id, eventOption.id));
  await page.goto(`/events/${draftEvent.id}/edit`);
  await expect(page.getByTestId('event-graph-readonly')).toContainText(
    'legacy random allocation',
  );
  await expect(page.getByTestId('save-event-graph')).toHaveCount(0);
});
