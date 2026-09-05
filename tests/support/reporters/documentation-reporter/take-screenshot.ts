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
  options: Readonly<{ cropTo?: Locator }> = {},
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
        await settleScreenshotPage(page);
      }
    }
    if (lastError) throw lastError;
  };

  const failures: unknown[] = [];
  try {
    for (const locator of focusPoints) {
      await runWithRetry(async () => {
        const target = locator.first();
        await target.waitFor({ state: 'attached' });
        await target.evaluate((element) => {
          const htmlElement = element as HTMLElement;
          htmlElement.scrollIntoView({ behavior: 'instant', block: 'center' });
          htmlElement.dataset['docsPrevOutline'] =
            htmlElement.style.outline ?? '';
          htmlElement.dataset['docsPrevZIndex'] =
            htmlElement.style.zIndex ?? '';
          htmlElement.style.outline = 'thick solid rgb(236, 72, 153)';
          htmlElement.style.zIndex = '10000';
          return htmlElement;
        });
      });
    }

    await assertNoVisibleLoadingState(page);
    await testInfo.attach('image', {
      body: options.cropTo
        ? await options.cropTo.screenshot({ animations: 'disabled' })
        : await captureDocumentationScreenshot(page),
      contentType: 'image/png',
    });
    await testInfo.attach('image-caption', {
      body: normalizedCaption,
    });
  } catch (error) {
    failures.push(error);
  }

  for (const locator of focusPoints) {
    try {
      await runWithRetry(async () => {
        const target = locator.first();
        await target.waitFor({ state: 'attached' });
        await target.evaluate((element) => {
          const htmlElement = element as HTMLElement;
          if (!('docsPrevOutline' in htmlElement.dataset)) return htmlElement;
          htmlElement.style.outline =
            htmlElement.dataset['docsPrevOutline'] ?? '';
          htmlElement.style.zIndex =
            htmlElement.dataset['docsPrevZIndex'] ?? '';
          delete htmlElement.dataset['docsPrevOutline'];
          delete htmlElement.dataset['docsPrevZIndex'];
          return htmlElement;
        });
      });
    } catch (error) {
      if (!isDetachedError(error)) {
        failures.push(error);
      }
    }
  }

  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) {
    throw new AggregateError(
      failures,
      'Documentation screenshot and highlight cleanup failed',
    );
  }
}
