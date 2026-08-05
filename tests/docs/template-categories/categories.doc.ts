import { and, eq } from 'drizzle-orm';

import { adminStateFile } from '../../../helpers/user-data';
import * as schema from '../../../src/db/schema';
import { expect, test } from '../../support/fixtures/parallel-test';
import { takeScreenshot } from '../../support/reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Manage template categories', async ({
  database,
  page,
  tenant,
}, testInfo) => {
  const categoryTitle = 'Outdoor activities';
  const updatedCategoryTitle = 'Outdoor adventures';

  try {
    await page.goto('.');
    await testInfo.attach('markdown', {
      body: `
{% callout type="note" title="Who can do this" %}
You need **Manage template categories** access to create and edit categories.
{% /callout %}
Template categories keep related templates together and make them easier for members to find.

Members who can view templates without **Manage template categories** access can still open the category overview through **View categories**. They can browse categories but cannot create or edit them, and the page tells them to ask an administrator for access.

Start by navigating to the **Manage categories** page under **Templates**. Here you can see an overview of the existing template categories.
Select **Create category** to create a new category.`,
    });
    await page.getByRole('link', { name: 'Templates' }).click();
    await page.getByRole('link', { name: 'Manage categories' }).click();
    const categoriesTable = page.getByRole('table');
    await expect(categoriesTable).toBeVisible();
    const createCategoryButton = page.getByRole('button', {
      name: 'Create category',
    });
    await takeScreenshot(
      testInfo,
      createCategoryButton,
      page,
      'Template categories page with the Create category action',
    );
    await expect(createCategoryButton).not.toHaveAttribute(
      'jsaction',
      /click/,
      { timeout: 15_000 },
    );
    await expect(createCategoryButton).toBeEnabled();
    await createCategoryButton.click();
    await expect(
      page.getByRole('textbox', { name: 'Category title' }),
    ).toBeVisible();
    await testInfo.attach('markdown', {
      body: `
Review or choose an icon, enter the **Category title**, and select **Save**. The new category appears in the list.`,
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
To change a category's title or icon, find it in the list, select **Edit**, make the changes, and select **Save**.`,
    });

    const editCategoryButton = categoryRow.getByRole('button', {
      name: 'Edit',
    });
    await expect(editCategoryButton).not.toHaveAttribute('jsaction', /click/, {
      timeout: 15_000,
    });
    await expect(editCategoryButton).toBeEnabled();
    await editCategoryButton.click();
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
