import { Page } from '@playwright/test';
import { DateTime } from 'luxon';

const waitForVisibleLocator = async (
  page: Page,
  selectors: readonly string[],
  timeoutMs: number,
) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const locator = frame.locator(selector).first();
        if (await locator.isVisible().catch(() => false)) {
          return locator;
        }
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
};

export const fillTestCard = async (page: Page) => {
  const cardRadio = page.getByRole('radio', { name: /^Card$/i });
  if (await cardRadio.isVisible().catch(() => false)) {
    await cardRadio.check().catch(async () => {
      await cardRadio.click();
    });
  }
  const cardNumber = await waitForVisibleLocator(
    page,
    [
      'input[data-elements-stable-field-name="cardNumber"]',
      'input[name="cardnumber"]',
      'input[autocomplete="cc-number"]',
      'input[aria-label*="Card number"]',
    ],
    20_000,
  );
  const cardExpiry = await waitForVisibleLocator(
    page,
    [
      'input[data-elements-stable-field-name="cardExpiry"]',
      'input[name="exp-date"]',
      'input[autocomplete="cc-exp"]',
      'input[aria-label*="Expiration"]',
    ],
    10_000,
  );
  const cardCvc = await waitForVisibleLocator(
    page,
    [
      'input[data-elements-stable-field-name="cardCvc"]',
      'input[name="cvc"]',
      'input[autocomplete="cc-csc"]',
      'input[aria-label*="CVC"]',
      'input[aria-label*="Security code"]',
    ],
    10_000,
  );
  if (!cardNumber || !cardExpiry || !cardCvc) {
    throw new Error(
      `Stripe card inputs were not available in checkout (frames: ${page
        .frames()
        .map((frame) => frame.url())
        .join(', ')})`,
    );
  }
  await cardNumber.fill('4242424242424242');
  await cardExpiry.fill(DateTime.local().plus({ year: 1 }).toFormat('MM/yy'));
  await cardCvc.fill('123');
  const cardholderName = await waitForVisibleLocator(
    page,
    [
      'input[data-elements-stable-field-name="cardholderName"]',
      'input[name="cardholderName"]',
      'input[autocomplete="cc-name"]',
      'input[aria-label*="Cardholder"]',
    ],
    5_000,
  );
  if (cardholderName) {
    await cardholderName.fill('Automated Testuser');
  }
};
