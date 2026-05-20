import { organizerStateFile } from '../../../helpers/user-data';
import { DateTime } from 'luxon';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120_000);

test.use({ storageState: organizerStateFile });

test.skip('create event form template', async ({
  database,
  page,
  templates,
}) => {
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
    .fill(futureStart.toFormat('M/d/yyyy'));
  await eventForm.getByRole('combobox', { name: 'Start time' }).fill('1:00 PM');
  await eventForm
    .getByRole('textbox', { name: 'End date' })
    .fill(futureStart.toFormat('M/d/yyyy'));
  await eventForm.getByRole('combobox', { name: 'End time' }).fill('5:00 PM');

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
  ).toBeVisible();
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
