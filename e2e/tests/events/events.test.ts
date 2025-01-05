import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';

test.use({ storageState: defaultStateFile });

test('create event form template', async ({ page, templates }) => {
  const template = templates[0];
  await page.goto('.');
  await page.getByRole('link', { name: 'Event templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page
    .locator('app-template-list div', { hasText: template.title })
    .getByRole('link', { name: template.title })
    .click();
  await page.getByRole('link', { name: 'Create event' }).click();
  await expect(page).toHaveURL(`/templates/${template.id}/create-event`);
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/\/events/);
  await expect(page.locator('h1')).toHaveText(template.title);
});
