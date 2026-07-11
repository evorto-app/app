import { expect, type Locator, type Page } from '@playwright/test';

export const fillScannerGuestCheckInCount = async (
  page: Pick<Page, 'getByLabel' | 'getByRole'>,
  {
    guestCount,
    includeAttendee,
  }: {
    guestCount: number;
    includeAttendee: boolean;
  },
): Promise<Locator> => {
  const guestCountInput = page.getByLabel('Guests to check in now');
  const spotCount = guestCount + (includeAttendee ? 1 : 0);
  const confirmationButton = page.getByRole('button', {
    exact: true,
    name: spotCount > 1 ? `Confirm ${spotCount} check-ins` : 'Confirm check-in',
  });

  await expect(async () => {
    await guestCountInput.fill(String(guestCount));
    await expect(guestCountInput).toHaveValue(String(guestCount));
    await expect(confirmationButton).toBeVisible();
    await expect(confirmationButton).toBeEnabled();
  }).toPass({ timeout: 15_000 });

  return confirmationButton;
};

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
