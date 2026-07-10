import { organizerStateFile } from '../../../helpers/user-data';
import { DateTime } from 'luxon';
import { expect, test } from '../../support/fixtures/axe-test';

test.setTimeout(120_000);

test.use({
  storageState: organizerStateFile,
  timezoneId: 'America/Los_Angeles',
});

test('event list icon actions are named and keyboard operable', async ({
  makeAxeBuilder,
  page,
  permissionOverride,
}) => {
  await permissionOverride({
    add: ['events:seeDrafts', 'events:seeUnlisted'],
    roleName: 'Section member',
  });
  await page.goto('/events');

  const filterButton = page.getByRole('button', { name: 'Filter events' });
  const listActionsButton = page.getByRole('button', {
    name: 'Open event list actions',
  });
  await expect(filterButton).toBeVisible();
  await expect(listActionsButton).toBeVisible();

  const accessibilityScan = await makeAxeBuilder()
    .include('app-event-list > div > div > div:first-child')
    .analyze();
  expect(accessibilityScan.violations).toEqual([]);

  await filterButton.focus();
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Filter events' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Ok' }).click();

  await listActionsButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toBeVisible();
});

test('event authoring controls expose accessible names and keyboard interaction', async ({
  events,
  makeAxeBuilder,
  page,
  permissionOverride,
  roles,
}) => {
  await permissionOverride({
    add: ['events:changeListing'],
    roleName: 'Section member',
  });
  const draftEvent = events.find(
    (event) => event.status === 'DRAFT' && event.registrationOptions.length > 0,
  );
  if (!draftEvent) {
    throw new Error('Expected seeded draft event for accessibility checks');
  }

  const registrationOption = draftEvent.registrationOptions[0];
  const selectedRole = roles.find((role) =>
    registrationOption.roleIds.includes(role.id),
  );
  if (!selectedRole) {
    throw new Error(
      `Expected seeded draft event "${draftEvent.title}" to have a selected role`,
    );
  }

  await page.goto(`/events/${draftEvent.id}/edit`);
  await expect(
    page.getByRole('heading', { name: draftEvent.title }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('link', { name: 'Back to event' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open event actions' }),
  ).toBeVisible();

  const roleSelect = page.locator('app-role-select').first();
  await expect(
    roleSelect.getByRole('button', { name: `Remove ${selectedRole.name}` }),
  ).toBeAttached();
  const authoringAccessibilityScan = await makeAxeBuilder()
    .include('app-event-edit > div:first-child')
    .include('app-role-select')
    .analyze();
  expect(authoringAccessibilityScan.violations).toEqual([]);

  const roleChips = roleSelect.locator('mat-chip-row');
  const initialRoleCount = await roleChips.count();
  await roleSelect.getByPlaceholder('Add Role...').focus();
  await page.keyboard.press('Backspace');
  await expect(roleChips.last().getByRole('gridcell').first()).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(roleChips).toHaveCount(initialRoleCount - 1);

  const changeIconButton = page.getByRole('button', { name: 'Change Icon' });
  await changeIconButton.focus();
  await page.keyboard.press('Enter');

  const iconDialog = page.locator('app-icon-selector-dialog');
  await expect(iconDialog).toBeVisible();
  const iconChoice = iconDialog
    .getByRole('button', { name: /^Select .+ icon$/ })
    .first();
  await expect(iconChoice).toBeVisible();
  const dialogAccessibilityScan = await makeAxeBuilder()
    .include('app-icon-selector-dialog')
    .analyze();
  expect(dialogAccessibilityScan.violations).toEqual([]);

  await iconChoice.focus();
  await page.keyboard.press('Enter');
  await expect(iconDialog).toBeHidden();
});

test('create event form template', async ({ database, page, templates }) => {
  const template = templates.find((candidate) => candidate.seedKey === 'hike');
  if (!template) {
    throw new Error('Expected seeded hike template for event creation');
  }

  const options = await database.query.templateRegistrationOptions.findMany({
    where: { templateId: template.id },
  });
  if (options.length === 0) {
    throw new Error(
      `Expected seeded template "${template.title}" to have registration options`,
    );
  }
  if (
    options.some((option) => option.isPaid && option.stripeTaxRateId === null)
  ) {
    throw new Error(
      `Expected seeded template "${template.title}" paid options to have tax rates`,
    );
  }

  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: template.title }).click();
  await page.getByRole('link', { name: 'Create event' }).click();
  await expect(page).toHaveURL(`/templates/${template.id}/create-event`);
  await expect(page.getByLabel('Event title')).toHaveValue(template.title);

  const eventForm = page.locator('app-event-general-form');
  const futureStart = DateTime.now().plus({ months: 2 });
  await eventForm
    .getByRole('textbox', { name: 'Start date' })
    .fill(futureStart.setLocale('de-DE').toLocaleString(DateTime.DATE_SHORT));
  await eventForm.getByRole('combobox', { name: 'Start time' }).fill('13:00');
  await eventForm
    .getByRole('textbox', { name: 'End date' })
    .fill(futureStart.setLocale('de-DE').toLocaleString(DateTime.DATE_SHORT));
  await eventForm.getByRole('combobox', { name: 'End time' }).fill('17:00');

  const taxRateSelects = page.getByLabel('Tax rate');
  const taxRateCount = await taxRateSelects.count();
  for (let index = 0; index < taxRateCount; index += 1) {
    await taxRateSelects.nth(index).click();
    const option = page.getByRole('option').filter({ hasText: /%/ }).first();
    await expect(option).toBeVisible();
    await option.click();
  }
  const createButton = page.getByRole('button', { name: 'Create event' });
  await expect(createButton).toBeVisible();
  await expect(createButton).toBeEnabled();
  await createButton.click();
  await page.waitForURL(/\/events\//, { timeout: 20000 });
  await expect(page).toHaveURL(/\/events\/[a-z0-9]+/);

  const createdEventId = page.url().split('/').at(-1);
  if (!createdEventId) {
    throw new Error('Expected created event id in the detail URL');
  }
  const createdEvent = await database.query.eventInstances.findFirst({
    where: { id: createdEventId },
  });
  const createdEventTenant = createdEvent
    ? await database.query.tenants.findFirst({
        where: { id: createdEvent.tenantId },
      })
    : undefined;
  if (!createdEvent || !createdEventTenant) {
    throw new Error('Expected created event and tenant runtime settings');
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
});

test('event edit form hides selected roles in autocomplete', async ({
  events,
  page,
  roles,
}) => {
  const draftEvent = events.find(
    (event) => event.status === 'DRAFT' && event.registrationOptions.length > 0,
  );
  if (!draftEvent) {
    throw new Error('Expected seeded draft event for event role autocomplete');
  }

  const registrationOption = draftEvent.registrationOptions[0];
  const selectedRole = roles.find((role) =>
    registrationOption.roleIds.includes(role.id),
  );
  if (!selectedRole) {
    throw new Error(
      `Expected seeded draft event "${draftEvent.title}" to have selected registration roles`,
    );
  }

  const unselectedRole = roles.find(
    (role) => !registrationOption.roleIds.includes(role.id),
  );
  if (!unselectedRole) {
    throw new Error(
      `Expected seeded draft event "${draftEvent.title}" to have an unselected role for autocomplete`,
    );
  }

  await page.goto(`/events/${draftEvent.id}/edit`);
  await expect(page).toHaveURL(`/events/${draftEvent.id}/edit`);
  await expect(
    page.getByRole('heading', { name: draftEvent.title }),
  ).toBeVisible({ timeout: 20_000 });
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
});
