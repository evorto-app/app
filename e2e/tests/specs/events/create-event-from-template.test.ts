import { defaultStateFile } from '../../../../helpers/user-data';
import { expect, test } from '../../../fixtures/parallel-test';

test.setTimeout(120000);

test.use({ storageState: defaultStateFile });

test('creates event from template', async ({ page, templates }) => {
  const template = templates[0];
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: template.title }).click();
  await page.getByRole('link', { name: 'Create event' }).click();
  await expect(page).toHaveURL(`/templates/${template.id}/create-event`);
  const eventDetails = page.getByRole('heading', { name: 'Event Details' }).locator('..');
  await expect(eventDetails.getByLabel('Event title')).toHaveValue(template.title);
  await eventDetails.getByLabel('Start date').fill('01/15/2030');
  await eventDetails.getByLabel('Start time').fill('10:00 AM');
  await eventDetails.getByLabel('End date').fill('01/15/2030');
  await eventDetails.getByLabel('End time').fill('12:00 PM');
  const firstRegistration = page.locator('app-registration-option-form').first();
  await expect(firstRegistration.getByLabel('Start date')).not.toHaveValue('');
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/\/events/);
  await expect(
    page.getByRole('heading', { name: template.title, exact: true }),
  ).toBeVisible();
});
