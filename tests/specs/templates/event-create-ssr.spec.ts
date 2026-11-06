import { organizerStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.use({ javaScriptEnabled: false, storageState: organizerStateFile });

test('event creation waits for client handlers while its back link works without JavaScript', async ({
  page,
  templates,
}) => {
  const template = templates[0];
  if (!template) throw new Error('Expected a template');
  const path = `/templates/${template.id}/create-event`;
  await page.goto(path);
  const title = page.getByLabel('Event title', { exact: true });
  await expect(title).toHaveValue(template.title);
  await title.focus();
  await page.keyboard.type('Premature event submission');
  await page.keyboard.press('Enter');
  await expect(title).toHaveValue(template.title);
  await expect(page).toHaveURL(path);
  await page.getByRole('link', { name: 'Back to template' }).click();
  await expect(page).toHaveURL(`/templates/${template.id}`);
});
