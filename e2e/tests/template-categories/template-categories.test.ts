import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';

test.setTimeout(120000);

test.use({ storageState: defaultStateFile });

test('create template category', async ({ isMobile, page }) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  if (isMobile) {
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Template categories' }).click();
  } else {
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Template categories' }).click();
  }
  await expect(page).toHaveURL(/\/templates\/categories/);
  await page
    .getByRole('button', { name: 'Create a new category' })
    .first()
    .click();
  await expect(page.getByRole('heading', { name: 'Create a new category' })).toBeVisible();
  await page.getByLabel('Category title').fill('Mountain trips');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Mountain trips')).toBeVisible();
});

test('edit template category', async ({
  isMobile,
  page,
  templateCategories,
}) => {
  await page.goto('.');
  await page.getByRole('link', { name: 'Templates' }).click();
  await expect(page).toHaveURL(/\/templates/);
  if (isMobile) {
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Template categories' }).click();
  } else {
    await page.getByRole('button', { name: 'Menu' }).click();
    await page.getByRole('menuitem', { name: 'Template categories' }).click();
  }
  await expect(page).toHaveURL(/\/templates\/categories/);
  const category = templateCategories[0];
  await page.getByText(category.title).getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByRole('heading', { name: 'Edit category' })).toBeVisible();
  await expect(page.getByLabel('Category title')).toHaveValue(category.title);
  await page.getByLabel('Category title').fill('Mountain trips');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Mountain trips')).toBeVisible();
});
