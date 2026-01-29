import { adminStateFile } from '../../../helpers/user-data';
import { expect, test } from '../../fixtures/parallel-test';
import { takeScreenshot } from '../../reporters/documentation-reporter';

test.use({ storageState: adminStateFile });

test('Manage template categories', async ({ page }, testInfo) => {
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
  await takeScreenshot(
    testInfo,
    page.getByRole('button', { name: 'Create category' }),
    page,
  );
  await page.getByRole('button', { name: 'Create category' }).click();
  await testInfo.attach('markdown', {
    body: `
You can now enter the name for your category and save it. The new category will be created and added to the list.`,
  });
  await page
    .getByRole('textbox', { name: 'Category title' })
    .fill('Test category');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.locator('.category', { hasText: 'Test category' }),
  ).toBeVisible();
  await testInfo.attach('markdown', {
    body: `
To edit the name of a category, just find it in the list and click the _Edit_ button.
After you have changed the name, click on _Save_ to save your changes.`,
  });
  await page
    .locator('div.category')
    .filter({ hasText: 'Test category' })
    .getByRole('button', { name: 'Edit' })
    .click();
  await page
    .getByRole('textbox', { name: 'Category title' })
    .fill('Test category edited');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(
    page.locator('.category', { hasText: 'Test category edited' }),
  ).toBeVisible();
});
