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
  await page.getByRole('button', { name: 'Create event' }).click();
  await expect(page).toHaveURL(/\/events/);
  await expect(page.getByRole('heading', { name: template.title })).toBeVisible();
});
