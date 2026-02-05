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

  const placeholder = page.getByRole('button', {
    name: 'Click to edit content',
  });
  await placeholder.first().click();

  await page.waitForFunction(
    () => (window as typeof window & { tinymce?: any }).tinymce?.activeEditor,
    { timeout: 1000 },
  );

  await page.evaluate((value) => {
    const tinymce = (window as typeof window & { tinymce?: any }).tinymce;
    tinymce.activeEditor.setContent(value);
    // tinymce.activeEditor.fire('change');
  }, description);
};
