import type { Locator, Page } from '@playwright/test';

export const waitForScannerAddonFulfillment = async (
  page: Pick<Page, 'getByRole'>,
): Promise<Locator> => {
  const heading = page.getByRole('heading', {
    exact: true,
    name: 'Add-on fulfillment',
  });
  await heading.waitFor({ state: 'visible', timeout: 15_000 });
  return heading;
};
