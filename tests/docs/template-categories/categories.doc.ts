import { and, eq } from 'drizzle-orm';
import type { Locator, Page } from '@playwright/test';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

const categoryDialogSurface = (page: Page, title: string): Locator =>
  page
    .locator('mat-dialog-container')
    .filter({ has: page.getByRole('heading', { name: title }) })
    .filter({ has: page.getByRole('textbox', { name: 'Category title' }) })
    .filter({ has: page.getByRole('button', { name: 'Save' }) })
    .first();

test('Manage template categories', async ({
  database,
  page,
  seedDate,
  tenant,
}, testInfo) => {
  const categoryTitle = `Category docs ${seedDate.getTime()}`;
  const updatedCategoryTitle = `Category docs edited ${seedDate.getTime()}`;

  try {
    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="User permissions" %}
For this guide, we assume you have an account with all required permissions. These are:
- **templates:manageCategories**: This permission is required to create and manage template categories.
{% /callout %}
Template categories are used to group templates together. You can create categories and assign templates to them.
Users will have an easier time finding the templates they are looking for with good grouping.

Start by navigating to the **Manage categories** page under **Templates**. Here you can see an overview of the existing template categories.
Click on _Create category_ to create a new category.`,
    });
    await page.getByRole('link', { name: 'Templates' }).click();
    await page.getByRole('link', { name: 'Manage categories' }).click();
    const categoriesTable = page.getByRole('table');
    await expect(categoriesTable).toBeVisible();
    await takeScreenshot(
      testInfo,
      page.getByRole('button', { name: 'Create category' }),
      page,
      'Template category manager with the create-category action highlighted',
    );
    await page.getByRole('button', { name: 'Create category' }).click();
    await expect(
      page.getByRole('textbox', { name: 'Category title' }),
    ).toBeVisible();
    const createCategoryForm = categoryDialogSurface(
      page,
      'Create a new category',
    );
    await expect(
      createCategoryForm.getByRole('button', { name: 'Save' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      createCategoryForm,
      page,
      'Template category create dialog with title and save action',
    );
    await testInfo.attach('markdown', {
      body: `
You can now enter the name for your category and save it. The new category will be created and added to the list.`,
    });
    await page
      .getByRole('textbox', { name: 'Category title' })
      .fill(categoryTitle);
    await page.getByRole('button', { name: 'Save' }).click();

    const categoryRow = categoriesTable
      .getByRole('row')
      .filter({ hasText: categoryTitle })
      .first();
    await expect(categoryRow).toBeVisible();
    await takeScreenshot(
      testInfo,
      categoryRow,
      page,
      'New template category row after saving',
    );

    const createdCategory =
      await database.query.eventTemplateCategories.findFirst({
        where: {
          tenantId: tenant.id,
          title: categoryTitle,
        },
      });
    if (!createdCategory) {
      throw new Error(
        'Expected generated category docs to persist the category',
      );
    }
    await testInfo.attach('markdown', {
      body: `
To edit the name of a category, just find it in the list and click the _Edit_ button.
After you have changed the name, click on _Save_ to save your changes.`,
    });

    await categoryRow.getByRole('button', { name: 'Edit' }).click();
    await expect(
      page.getByRole('textbox', { name: 'Category title' }),
    ).toBeVisible();
    await expect(
      page.getByRole('textbox', { name: 'Category title' }),
    ).toHaveValue(categoryTitle);
    const editCategoryForm = categoryDialogSurface(page, 'Edit category');
    await expect(
      editCategoryForm.getByRole('button', { name: 'Save' }),
    ).toBeVisible();
    await takeScreenshot(
      testInfo,
      editCategoryForm,
      page,
      'Template category edit dialog with existing title and save action',
    );
    await page
      .getByRole('textbox', { name: 'Category title' })
      .fill(updatedCategoryTitle);
    await page.getByRole('button', { name: 'Save' }).click();
    const updatedCategoryRow = categoriesTable
      .getByRole('row')
      .filter({ hasText: updatedCategoryTitle })
      .first();
    await expect(updatedCategoryRow).toBeVisible();
    await takeScreenshot(
      testInfo,
      updatedCategoryRow,
      page,
      'Updated template category row after renaming',
    );

    const updatedCategory =
      await database.query.eventTemplateCategories.findFirst({
        where: {
          id: createdCategory.id,
          tenantId: tenant.id,
        },
      });
    if (!updatedCategory) {
      throw new Error(
        'Expected generated category docs to update the category',
      );
    }
    expect(updatedCategory.title).toBe(updatedCategoryTitle);
  } finally {
    await database
      .delete(schema.eventTemplateCategories)
      .where(
        and(
          eq(schema.eventTemplateCategories.tenantId, tenant.id),
          eq(schema.eventTemplateCategories.title, updatedCategoryTitle),
        ),
      );
    await database
      .delete(schema.eventTemplateCategories)
      .where(
        and(
          eq(schema.eventTemplateCategories.tenantId, tenant.id),
          eq(schema.eventTemplateCategories.title, categoryTitle),
        ),
      );
  }
});
