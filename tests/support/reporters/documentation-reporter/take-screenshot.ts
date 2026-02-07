import { Locator, Page, TestInfo } from '@playwright/test';

export async function takeScreenshot(
  testInfo: TestInfo,
  locators: Locator | Locator[],
  page: Page,
  caption?: string,
) {
  await page.waitForTimeout(1000);
  const focusPoints = Array.isArray(locators) ? locators : [locators];

  const isDetachedError = (error: unknown) =>
    error instanceof Error &&
    error.message.includes('Element is not attached to the DOM');

  const runWithRetry = async (
    run: () => Promise<void>,
    attempts: number = 5,
  ): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        await run();
        return;
      } catch (error) {
        lastError = error;
        if (!isDetachedError(error) || attempt === attempts - 1) {
          throw error;
        }
        await page.waitForTimeout(100);
      }
    }
    if (lastError) throw lastError;
  };

  for (const locator of focusPoints) {
    await runWithRetry(async () => {
      const target = locator.first();
      await target.waitFor({ state: 'attached' });
      await target.evaluate((element) => {
        const htmlElement = element as HTMLElement;
        htmlElement.scrollIntoView({ behavior: 'instant', block: 'center' });
        htmlElement.dataset['docsPrevOutline'] = htmlElement.style.outline ?? '';
        htmlElement.dataset['docsPrevZIndex'] = htmlElement.style.zIndex ?? '';
        htmlElement.style.outline = 'thick solid rgb(236, 72, 153)';
        htmlElement.style.zIndex = '10000';
        return htmlElement;
      });
    });
  }

  await testInfo.attach('image', {
    body: await page.screenshot({
      style: '.tsqd-parent-container { display: none; }',
    }),
    contentType: 'image/png',
  });
  if (caption) {
    await testInfo.attach('image-caption', {
      body: caption,
    });
  }

  for (const locator of focusPoints) {
    try {
      await runWithRetry(async () => {
        const target = locator.first();
        await target.waitFor({ state: 'attached' });
        await target.evaluate((element) => {
          const htmlElement = element as HTMLElement;
          htmlElement.style.outline = htmlElement.dataset['docsPrevOutline'] ?? '';
          htmlElement.style.zIndex = htmlElement.dataset['docsPrevZIndex'] ?? '';
          delete htmlElement.dataset['docsPrevOutline'];
          delete htmlElement.dataset['docsPrevZIndex'];
          return htmlElement;
        });
      });
    } catch (error) {
      if (!isDetachedError(error)) {
        throw error;
      }
    }
  }
}

