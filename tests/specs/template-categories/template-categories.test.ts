import { defaultStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../support/fixtures/parallel-test';

test.setTimeout(120000);

test.use({ storageState: defaultStateFile });

test('create template category', async ({
  database,
  isMobile,
  page,
  seedDate,
  tenant,
}) => {
  const categoryTitle = `Mountain trips ${seedDate.getTime()}`;

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
  await page.getByLabel('Category title').fill(categoryTitle);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    categoriesTable.getByRole('row').filter({ hasText: categoryTitle }),
  ).toBeVisible();

  const createdCategory =
    await database.query.eventTemplateCategories.findFirst({
      where: {
        tenantId: tenant.id,
        title: categoryTitle,
      },
    });
  if (!createdCategory) {
    throw new Error('Expected created template category row after save');
  }
  expect(createdCategory).toEqual(
    expect.objectContaining({
      tenantId: tenant.id,
      title: categoryTitle,
    }),
  );
});

test('edit template category', async ({
  database,
  isMobile,
  page,
  seedDate,
  templateCategories,
  tenant,
}) => {
  const category = templateCategories[0];
  if (!category) {
    throw new Error('Expected seeded template category before editing');
  }
  const updatedTitle = `Mountain trips ${seedDate.getTime()}`;

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
  const categoryRow = categoriesTable
    .getByRole('row')
    .filter({ hasText: category.title });
  await categoryRow.getByRole('button', { name: 'Edit' }).click();
  await expect(page.getByLabel('Category title')).toBeVisible();
  await expect(page.getByLabel('Category title')).toHaveValue(category.title);
  await page.getByLabel('Category title').fill(updatedTitle);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    categoriesTable.getByRole('row').filter({ hasText: updatedTitle }),
  ).toBeVisible();

  const updatedCategory =
    await database.query.eventTemplateCategories.findFirst({
      where: {
        id: category.id,
        tenantId: tenant.id,
      },
    });
  if (!updatedCategory) {
    throw new Error('Expected edited template category row after save');
  }
  expect(updatedCategory).toEqual(
    expect.objectContaining({
      id: category.id,
      tenantId: tenant.id,
      title: updatedTitle,
    }),
  );
});
