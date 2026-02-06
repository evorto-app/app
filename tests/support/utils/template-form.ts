import { expect, Page } from '@playwright/test';

type TemplateFormOptions = {
  categoryTitle: string;
  description?: string;
  title: string;
};

export const fillTemplateBasics = async (
  page: Page,
  {
    title,
    categoryTitle,
    description = 'Test template description.',
  }: TemplateFormOptions,
) => {
  await page.getByLabel('Template title').fill(title);
  await page.getByLabel('Template Category').locator('svg').click();
  await page
    .getByLabel('Template Category')
    .getByRole('option', { name: categoryTitle })
    .click();

  await page.getByRole('button', { name: 'Change Icon' }).click();
  await expect(
    page.getByRole('heading', { name: 'Select an Icon' }),
  ).toBeVisible();
  await page.locator('app-icon-selector-dialog').getByText('Alps').click();

  const placeholder = page.getByTestId('rich-editor-placeholder').first();
  await placeholder.click();

  const editor = page.getByTestId('rich-editor-content').first();
  await expect(editor).toBeVisible();
  await editor.fill(description);
};
