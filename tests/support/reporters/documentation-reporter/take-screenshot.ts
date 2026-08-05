import { Locator, Page, TestInfo } from '@playwright/test';

const settleScreenshotPage = async (page: Page): Promise<void> => {
  await page.locator('body').waitFor({ state: 'visible' });
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      }),
  );
};

const assertNoVisibleLoadingState = async (page: Page): Promise<void> => {
  const visibleLoadingCopy = page
    .getByText(/^Loading(?:\s+.*?)?(?:…|\.{3})$/u)
    .filter({ visible: true });
  const messages = await visibleLoadingCopy.allTextContents();
  if (messages.length > 0) {
    throw new Error(
      `Documentation screenshot still contains loading copy: ${messages.join(', ')}`,
    );
  }
};

export const captureDocumentationScreenshot = async (page: Page) => {
  await settleScreenshotPage(page);
  await assertNoVisibleLoadingState(page);

  return page.screenshot({
    animations: 'disabled',
    style: '.tsqd-parent-container { display: none; }',
  });
};

export async function takeScreenshot(
  testInfo: TestInfo,
  locators: Locator | Locator[],
  page: Page,
  caption: string,
) {
  const normalizedCaption = caption.trim();
  if (!normalizedCaption) {
    throw new Error('Documentation screenshots require a caption.');
  }

  await settleScreenshotPage(page);
  const focusPoints = Array.isArray(locators) ? locators : [locators];

  const isDetachedError = (error: unknown) =>
    error instanceof Error &&
    error.message.includes('Element is not attached to the DOM');

  for (const locator of focusPoints) {
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
  }

  await testInfo.attach('image', {
    body: await captureDocumentationScreenshot(page),
    contentType: 'image/png',
  });
  await testInfo.attach('image-caption', {
    body: normalizedCaption,
  });

  for (const locator of focusPoints) {
    try {
      const target = locator.first();
      await target.waitFor({ state: 'attached' });
      await target.evaluate((element) => {
        const htmlElement = element as HTMLElement;
        htmlElement.style.outline =
          htmlElement.dataset['docsPrevOutline'] ?? '';
        htmlElement.style.zIndex = htmlElement.dataset['docsPrevZIndex'] ?? '';
        delete htmlElement.dataset['docsPrevOutline'];
        delete htmlElement.dataset['docsPrevZIndex'];
        return htmlElement;
      });
    } catch (error) {
      if (!isDetachedError(error)) {
        throw error;
      }
    }
  }
}
