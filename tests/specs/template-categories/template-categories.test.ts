import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120000);

test.use({ storageState: defaultStateFile });

test('create template category @track(playwright-specs-track-linking_20260126) @req(TEMPLATE-CATEGORIES-TEST-01)', async ({
  isMobile,
  page,
}) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  if (isMobile) {
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Manage categories' }).click();
  } else {
    await page.getByRole('link', { name: 'Manage categories' }).click();
  }
  await expect(page).toHaveURL(/\/templates\/categories/);
  const categoriesTable = page.getByRole('table');
  await expect(categoriesTable).toBeVisible();
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByLabel('Category title')).toBeVisible();
  await page.getByLabel('Category title').fill('Mountain trips');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    categoriesTable
      .getByRole('row')
      .filter({ hasText: 'Mountain trips' })
      .first(),
  ).toBeVisible();
});

test('edit template category @track(playwright-specs-track-linking_20260126) @req(TEMPLATE-CATEGORIES-TEST-02)', async ({
  isMobile,
  page,
  templateCategories,
}) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  if (isMobile) {
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Manage categories' }).click();
  } else {
    await page.getByRole('link', { name: 'Manage categories' }).click();
  }
  await expect(page).toHaveURL(/\/templates\/categories/);
  const categoriesTable = page.getByRole('table');
  await expect(categoriesTable).toBeVisible();
  const category = templateCategories[0];
  const categoryRow = categoriesTable
    .getByRole('row')
    .filter({ hasText: category.title })
    .first();
  await categoryRow.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Category title')).toBeVisible();
  await expect(page.getByLabel('Category title')).toHaveValue(category.title);
  await page.getByLabel('Category title').fill('Mountain trips');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    categoriesTable
      .getByRole('row')
      .filter({ hasText: 'Mountain trips' })
      .first(),
  ).toBeVisible();
});
