import { defaultStateFile } from '../../helpers/user-data';
import { expect, test } from '../fixtures/parallel-test';

test.setTimeout(120000);

test.use({ storageState: defaultStateFile });

test.skip('create template category @track(playwright-specs-track-linking_20260126) @req(TEMPLATE-CATEGORIES-TEST-01)', async ({ isMobile, page }) => {
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
  await expect(page.locator('.category').first()).toBeVisible();
  await page.getByRole('button', { name: 'Create category' }).click();
  await expect(
    page.getByRole('heading', { name: 'Create a new category' }),
  ).toBeVisible();
  await page.getByLabel('Category title').fill('Mountain trips');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.locator('.category', { hasText: 'Mountain trips' }),
  ).toBeVisible();
});

test.skip('edit template category @track(playwright-specs-track-linking_20260126) @req(TEMPLATE-CATEGORIES-TEST-02)', async ({
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
  await expect(page.locator('.category').first()).toBeVisible();
  const category = templateCategories[0];
  const categoryCard = page.locator('.category', { hasText: category.title });
  await categoryCard.getByRole('button', { name: 'Edit' }).click();
  await expect(
    page.getByRole('heading', { name: 'Edit category' }),
  ).toBeVisible();
  await expect(page.getByLabel('Category title')).toHaveValue(category.title);
  await page.getByLabel('Category title').fill('Mountain trips');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.locator('.category', { hasText: 'Mountain trips' }),
  ).toBeVisible();
});
