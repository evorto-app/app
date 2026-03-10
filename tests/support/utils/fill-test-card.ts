import { Page } from '@playwright/test';

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

const handleLinkInterstitial = async (page: Page) => {
  const payWithoutLinkButton = page.getByRole('button', {
    name: 'Pay without Link',
  });
  if (await payWithoutLinkButton.isVisible().catch(() => false)) {
    await payWithoutLinkButton.click();
    return;
  }

  const otpFirstDigit = page.getByRole('textbox', {
    name: 'one-time-code-input-0',
  });
  if (await otpFirstDigit.isVisible().catch(() => false)) {
    await otpFirstDigit.click();
    await page.keyboard.type('000000');
    await payWithoutLinkButton
      .waitFor({ state: 'visible', timeout: 5_000 })
      .catch(() => {});
    if (await payWithoutLinkButton.isVisible().catch(() => false)) {
      await payWithoutLinkButton.click();
    }
  }
};

export const fillTestCard = async (page: Page) => {
  await handleLinkInterstitial(page);

  const cardRadio = page.getByRole('radio', { name: /^Card$/i });
  if (await cardRadio.isVisible().catch(() => false)) {
    const isAlreadyChecked = await cardRadio.isChecked().catch(() => false);
    if (!isAlreadyChecked) {
      await cardRadio.check({ timeout: 5_000 }).catch(async () => {
        await cardRadio.click({ force: true, timeout: 5_000 }).catch(() => {});
      });
    }
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
  await cardExpiry.fill('12/34');
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
  const postalCode = await waitForVisibleLocator(
    page,
    [
      'input[data-elements-stable-field-name="postalCode"]',
      'input[name="postalCode"]',
      'input[autocomplete="postal-code"]',
      'input[aria-label="ZIP"]',
      'input[aria-label*="Postal"]',
    ],
    2_000,
  );
  if (postalCode) {
    await postalCode.fill('12345');
  }
  const phoneNumber = await waitForVisibleLocator(
    page,
    [
      'input[data-elements-stable-field-name="phoneNumber"]',
      'input[name="phoneNumber"]',
      'input[autocomplete="tel"]',
      'input[aria-label="Phone number"]',
      'input[aria-label*="Phone"]',
    ],
    2_000,
  );
  if (phoneNumber) {
    await phoneNumber.fill('2015550123');
  }
};
