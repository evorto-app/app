import { expect, Page } from '@playwright/test';

type TemplateFormOptions = {
  categoryTitle: string;
  description?: string;
  title: string;
};

export const fillTemplateBasics = async (
  page: Page,
  { title, categoryTitle, description = 'Test template description.' }: TemplateFormOptions,
) => {
  await page.getByLabel('Template title').fill(title);
  await page.getByLabel('Template Category').locator('svg').click();
  await page
    .getByLabel('Template Category')
    .getByRole('option', { name: categoryTitle })
    .click();

  await page.getByRole('button', { name: 'Change Icon' }).click();
  await expect(page.getByRole('heading', { name: 'Select an Icon' })).toBeVisible();
  await page.locator('[mat-dialog-close]').first().click();

  const descriptionSet = await page.evaluate((value) => {
    const appEditor = document.querySelector('app-template-form');
    const ng = (window as typeof window & { ng?: { getComponent?: (el: Element) => any } }).ng;
    if (!ng?.getComponent || !appEditor) return false;
    const component = ng.getComponent(appEditor);
    const control = component?.templateForm?.controls?.description;
    if (!control?.setValue) return false;
    control.setValue(value);
    return true;
  }, description);

  if (!descriptionSet) {
    const placeholder = page.getByRole('button', { name: 'Click to edit content' });
    if (await placeholder.count()) {
      await placeholder.first().click();
    }

    const editorBody = page
      .frameLocator('iframe[title="Rich Text Area"]')
      .locator('body');
    await editorBody.waitFor({ timeout: 5000 });
    await editorBody.fill(description);
  }
};
