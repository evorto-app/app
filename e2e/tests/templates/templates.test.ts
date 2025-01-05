import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';

test.use({ storageState: defaultStateFile });

test('create template in empty category', async ({
  page,
  templateCategories,
}) => {
  const category = templateCategories[0];
  await page.goto('.');
  await page.getByRole('link', { name: 'Event templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page
    .locator('app-template-list div', { hasText: category.title })
    .getByRole('link', { name: 'Add template to this category' })
    .click();
  await expect(page).toHaveURL(`/templates/create/${category.id}`);
  await expect(page.getByLabel('Template Category')).toHaveText(category.title);
});

test('create a new template', async ({ page, templateCategories }) => {
  const category = templateCategories[0];
  await page.goto('.');
  await page.getByRole('link', { name: 'Event templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: 'Create template' }).click();
  await expect(page).toHaveURL(`/templates/create`);
  await page.getByLabel('Template title').fill('Historical tour');
  await page.getByLabel('Template Category').locator('svg').click();
  await page
    .getByLabel('Template Category')
    .getByRole('option', { name: category.title })
    .click();
  await page.getByRole('button', { name: 'Save template' }).click();
  // await page.waitForTimeout(1000);
  await expect(
    page
      .locator('app-template-list div', { hasText: category.title })
      .locator('a', { hasText: 'Historical tour' }),
  ).toBeVisible();
});

test('view a template', async ({ page, templates }) => {
  const template = templates[0];
  await page.goto('.');
  await page.getByRole('link', { name: 'Event templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page
    .locator('app-template-list div', { hasText: template.title })
    .getByRole('link', { name: template.title })
    .click();
  await expect(page).toHaveURL(`/templates/${template.id}`);
});
