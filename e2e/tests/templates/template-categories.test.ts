import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';

test.use({ storageState: defaultStateFile });

test('create template category', async ({ page }) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Event templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: 'template categories' }).click();
  await expect(page).toHaveURL(/\/templates\/categories/);
  await page
    .getByRole('button', { name: 'Create a new category' })
    .first()
    .click();
  await expect(page.locator('app-create-edit-category-dialog h1')).toHaveText(
    'Create a new category',
  );
  await page.getByLabel('Category title').fill('Mountain trips');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('app-category-list')).toContainText(
    'Mountain trips',
  );
});

test('edit template category', async ({ page, templateCategories }) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Event templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  await page.getByRole('link', { name: 'template categories' }).click();
  await expect(page).toHaveURL(/\/templates\/categories/);
  const category = templateCategories[0];
  await page
    .locator('app-category-list div', { hasText: category.title })
    .getByRole('button', { name: 'Edit' })
    .click();
  await expect(page.locator('app-create-edit-category-dialog h1')).toHaveText(
    'Edit category',
  );
  await expect(page.getByLabel('Category title')).toHaveValue(category.title);
  await page.getByLabel('Category title').fill('Mountain trips');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('app-category-list')).toContainText(
    'Mountain trips',
  );
});
