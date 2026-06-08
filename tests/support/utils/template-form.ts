import { expect, Page } from '@playwright/test';

type TemplateFormOptions = {
  categoryTitle?: string;
  description?: null | string;
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
  if (categoryTitle) {
    await page.locator('app-template-general-form mat-select').first().click();
    await page.getByRole('option', { name: categoryTitle }).click();
  }

  const changeIconButton = page.getByRole('button', { name: 'Change Icon' });
  const hasIconPicker = await changeIconButton
    .waitFor({ state: 'visible', timeout: 1000 })
    .then(() => true)
    .catch(() => false);
  if (hasIconPicker) {
    await changeIconButton.click();
    await expect(
      page.getByRole('heading', { name: 'Select an Icon' }),
    ).toBeVisible();
    await page.locator('app-icon-selector-dialog').getByText('Alps').click();
  }

  if (description !== null) {
    const placeholder = page.getByTestId('rich-editor-placeholder').first();
    if (await placeholder.isVisible()) {
      await placeholder.click();
    }

    const editor = page.getByTestId('rich-editor-content').first();
    await expect(editor).toBeVisible();
    await editor.fill(description);
  }

  const titleInput = page
    .getByLabel('Template title')
    .or(page.locator('app-template-general-form input').first());
  await titleInput.fill(title);
  await expect(titleInput).toHaveValue(title);
};
