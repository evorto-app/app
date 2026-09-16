import {
  ElementHandle,
  expect,
  Locator,
  Page,
  TestInfo,
} from '@playwright/test';

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
  try {
    await expect(visibleLoadingCopy).toHaveCount(0);
  } catch (cause) {
    const messages = await visibleLoadingCopy.allTextContents();
    if (messages.length === 0) throw cause;
    throw new Error(
      `Documentation screenshot still contains loading copy: ${messages.join(', ')}`,
      { cause },
    );
  }
};

export const captureDocumentationScreenshot = async (
  page: Page,
  options: Readonly<{
    beforeCapture?: () => Promise<void>;
    cropTo?: Locator;
    focusPoints?: readonly Locator[];
  }> = {},
) => {
  if (options.cropTo) {
    await expect(options.cropTo).toBeVisible();
    await options.cropTo.scrollIntoViewIfNeeded();
  }
  await settleScreenshotPage(page);
  await assertNoVisibleLoadingState(page);
  for (const locator of options.focusPoints ?? []) {
    await expect(locator.first()).toBeVisible();
  }
  if (options.cropTo) {
    await expect(options.cropTo).toBeVisible();
  }
  await options.beforeCapture?.();
  if (options.cropTo) {
    return options.cropTo.screenshot({ animations: 'disabled' });
  }

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
  const highlightedElements: ElementHandle<HTMLElement | SVGElement>[] = [];
  const highlightFocusPoints = async (scroll: boolean) => {
    for (const locator of focusPoints) {
      await runWithRetry(async () => {
        const target = await locator.first().elementHandle();
        if (!target) throw new Error('Element is not attached to the DOM');
        highlightedElements.push(target);
        await target.evaluate((htmlElement, scroll) => {
          if (scroll) {
            htmlElement.scrollIntoView({
              behavior: 'instant',
              block: 'center',
            });
          }
          if (!('docsPrevOutline' in htmlElement.dataset)) {
            htmlElement.dataset['docsPrevOutline'] = htmlElement.style.outline;
            htmlElement.dataset['docsPrevZIndex'] = htmlElement.style.zIndex;
          }
          htmlElement.style.outline = 'thick solid rgb(236, 72, 153)';
          htmlElement.style.zIndex = '10000';
          return htmlElement;
        }, scroll);
      });
    }
  };
  try {
    await highlightFocusPoints(true);

    await testInfo.attach('image', {
      body: await captureDocumentationScreenshot(page, {
        ...options,
        beforeCapture: () => highlightFocusPoints(false),
        focusPoints,
      }),
      contentType: 'image/png',
    });
    await testInfo.attach('image-caption', {
      body: normalizedCaption,
    });
  } catch (error) {
    failures.push(error);
  }

  for (const target of highlightedElements) {
    try {
      await target.evaluate((htmlElement) => {
        if (!('docsPrevOutline' in htmlElement.dataset)) return;
        htmlElement.style.outline =
          htmlElement.dataset['docsPrevOutline'] ?? '';
        htmlElement.style.zIndex = htmlElement.dataset['docsPrevZIndex'] ?? '';
        delete htmlElement.dataset['docsPrevOutline'];
        delete htmlElement.dataset['docsPrevZIndex'];
      });
    } catch (error) {
      if (!isDetachedError(error)) {
        failures.push(error);
      }
    } finally {
      try {
        await target.dispose();
      } catch (error) {
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
