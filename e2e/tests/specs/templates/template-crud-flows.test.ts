import { defaultStateFile } from '../../../../helpers/user-data';
import { expect, test } from '../../../fixtures/parallel-test';

test.setTimeout(120000);

test.use({ storageState: defaultStateFile });

test('creates template in empty category', async ({ page, templateCategories }) => {
  const category = templateCategories[0];
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page
    .getByRole('heading', { name: category.title })
    .locator('..')
    .getByRole('link', { name: 'Add template to this category' })
    .click();
  await expect(page).toHaveURL(`/templates/create/${category.id}`);
  await expect(page.getByLabel('Template Category')).toHaveText(category.title);
});

test('creates new template', async ({ page, templateCategories }) => {
  const category = templateCategories[0];
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: 'Create template' }).click();
  await expect(page).toHaveURL(`/templates/create`);
  await page.getByLabel('Template title').fill('Historical tour');
  await page.getByLabel('Template Category').locator('svg').click();
  await page.getByLabel('Template Category').getByRole('option', { name: category.title }).click();
  await page.getByRole('button', { name: 'Save template' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await expect(page.getByRole('link', { name: 'Historical tour' })).toBeVisible();
});

test('views existing template details', async ({ page, templates }) => {
  const template = templates[0];
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: template.title }).click();
  await expect(page).toHaveURL(`/templates/${template.id}`);
});
