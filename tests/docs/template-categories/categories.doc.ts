import { and, eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

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

Users who can view templates without **templates:manageCategories** can still open the category overview through **View categories**. The page is read-only for them: create and edit actions are hidden, and the page explains which permission an administrator needs to grant.

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
    );
    await page.getByRole('button', { name: 'Create category' }).click();
    await expect(
      page.getByRole('textbox', { name: 'Category title' }),
    ).toBeVisible();
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
    await page
      .getByRole('textbox', { name: 'Category title' })
      .fill(updatedCategoryTitle);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(
      categoriesTable
        .getByRole('row')
        .filter({ hasText: updatedCategoryTitle })
        .first(),
    ).toBeVisible();

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
