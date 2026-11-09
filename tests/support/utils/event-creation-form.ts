import { expect, type Page } from '@playwright/test';

export const waitForEventCreationFormReady = async (page: Page) => {
  const form = page.locator('form').filter({
    has: page.getByRole('textbox', { name: 'Event title', exact: true }),
  });
  await expect(form).not.toHaveAttribute('inert', { timeout: 20_000 });
};
