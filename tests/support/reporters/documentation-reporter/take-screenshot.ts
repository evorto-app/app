import { Locator, Page, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

const animationSettleTimeoutMs = 2_000;
const locatorSettleTimeoutMs = 1_500;
const snackbarSettleTimeoutMs = 750;
const highlightedTargetColor = { b: 153, g: 72, r: 236 };
const minimumHighlightedPixelCount = 16;

export const countDocumentationHighlightPixels = (image: Buffer): number => {
  const png = (() => {
    try {
      return PNG.sync.read(image);
    } catch {
      return null;
    }
  })();
  let highlightedPixels = 0;

  if (!png) {
    return highlightedPixels;
  }

  for (let offset = 0; offset < png.data.length; offset += 4) {
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];

    if (
      a > 0 &&
      r === highlightedTargetColor.r &&
      g === highlightedTargetColor.g &&
      b === highlightedTargetColor.b
    ) {
      highlightedPixels += 1;
    }
  }

  return highlightedPixels;
};

const assertHighlightedTargetCaptured = (image: Buffer): void => {
  const highlightedPixels = countDocumentationHighlightPixels(image);

  if (highlightedPixels < minimumHighlightedPixelCount) {
    throw new Error(
      'Documentation screenshots must include the highlighted focus target.',
    );
  }
};

const isTimeoutError = (error: unknown): boolean =>
  error instanceof Error &&
  (error.name === 'TimeoutError' || error.message.includes('Timeout'));

const ignoreTimeout =
  <T>(fallback: T) =>
  (error: unknown): T => {
    if (isTimeoutError(error)) {
      return fallback;
    }

    throw error;
  };

const waitForLoadingIndicators = async (page: Page): Promise<void> => {
  const loadingIndicator = page.getByText(/^Loading\b.*$/).first();
  const isLoading = await loadingIndicator
    .isVisible({ timeout: 250 })
    .catch(ignoreTimeout(false));

  if (isLoading) {
    await loadingIndicator.waitFor({ state: 'hidden', timeout: 15_000 });
  }
};

const waitForSnackbars = async (page: Page): Promise<void> => {
  const snackbar = page
    .locator('mat-snack-bar-container, .mat-mdc-snack-bar-container')
    .first();
  const isVisible = await snackbar
    .isVisible({ timeout: 250 })
    .catch(ignoreTimeout(false));

  if (isVisible) {
    await snackbar
      .waitFor({
        state: 'hidden',
        timeout: snackbarSettleTimeoutMs,
      })
      .catch(ignoreTimeout(undefined));
  }
};

const settleRenderFrame = async (page: Page): Promise<void> => {
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

const settleFiniteAnimations = async (page: Page): Promise<void> => {
  await waitForLoadingIndicators(page);
  await waitForSnackbars(page);
  await settleRenderFrame(page);
  await waitForLoadingIndicators(page);
  await waitForSnackbars(page);
  await page.evaluate(async (timeoutMs) => {
    const startedAt = performance.now();
    const waitForAnimationFrame = (): Promise<void> =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });

    while (performance.now() - startedAt < timeoutMs) {
      const runningAnimations = document
        .getAnimations({ subtree: true })
        .filter((animation) => {
          const timing = animation.effect?.getComputedTiming();
          return (
            timing &&
            timing.duration !== Number.POSITIVE_INFINITY &&
            timing.iterations !== Number.POSITIVE_INFINITY &&
            (animation.playState === 'pending' ||
              animation.playState === 'running')
          );
        });

      if (runningAnimations.length === 0) {
        return;
      }

      await Promise.race([
        Promise.allSettled(
          runningAnimations.map((animation) => animation.finished),
        ),
        waitForAnimationFrame(),
      ]);
    }
  }, animationSettleTimeoutMs);
  await settleRenderFrame(page);
  await settleRenderFrame(page);
  await settleRenderFrame(page);
  await waitForLoadingIndicators(page);
  await waitForSnackbars(page);
};

const waitForStableLocator = async (
  page: Page,
  locator: Locator,
): Promise<void> => {
  const target = locator.first();
  await target.waitFor({ state: 'visible' });
  const handle = await target.elementHandle();

  if (!handle) {
    return;
  }

  try {
    await page.waitForFunction(
      async (element) => {
        const snapshot = (target: Element) => {
          const bounds = target.getBoundingClientRect();
          return {
            height: Math.round(bounds.height),
            width: Math.round(bounds.width),
            x: Math.round(bounds.x),
            y: Math.round(bounds.y),
          };
        };

        const before = snapshot(element);
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => resolve());
          });
        });
        const after = snapshot(element);

        return (
          before.height === after.height &&
          before.width === after.width &&
          before.x === after.x &&
          before.y === after.y
        );
      },
      handle,
      { timeout: locatorSettleTimeoutMs },
    );
  } finally {
    await handle.dispose();
  }
};

export async function takeScreenshot(
  testInfo: TestInfo,
  locators: Locator | Locator[],
  page: Page,
  caption: string,
) {
  if (caption.trim().length < 24) {
    throw new Error(
      'Documentation screenshots require a descriptive caption of at least 24 characters.',
    );
  }

  await settleFiniteAnimations(page);
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
        await settleFiniteAnimations(page);
      }
    }
    if (lastError) throw lastError;
  };

  for (const [index, locator] of focusPoints.entries()) {
    const highlightId = `docs-highlight-${index}`;
    await runWithRetry(async () => {
      const target = locator.first();
      await target.waitFor({ state: 'attached' });
      await target.evaluate((element, currentHighlightId) => {
        const isRenderable = (candidate: Element): boolean => {
          const bounds = candidate.getBoundingClientRect();
          const style = getComputedStyle(candidate);

          return (
            bounds.width >= 1 &&
            bounds.height >= 1 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
          );
        };
        const highlightElement = (
          isRenderable(element)
            ? element
            : [element, ...Array.from(element.querySelectorAll('*'))].find(
                isRenderable,
              )
        ) as HTMLElement | undefined;
        const htmlElement = highlightElement ?? (element as HTMLElement);

        htmlElement.setAttribute(
          'data-docs-highlight-target',
          currentHighlightId,
        );
        htmlElement.scrollIntoView({ behavior: 'instant', block: 'center' });
        htmlElement.dataset['docsPrevOutline'] =
          htmlElement.style.outline ?? '';
        htmlElement.dataset['docsPrevZIndex'] = htmlElement.style.zIndex ?? '';
        htmlElement.style.outline = 'thick solid rgb(236, 72, 153)';
        htmlElement.style.zIndex = '10000';
        return htmlElement;
      }, highlightId);
      await waitForStableLocator(page, target);
    });
  }

  await settleFiniteAnimations(page);
  const image = await page.screenshot({
    animations: 'disabled',
    style:
      '.tsqd-parent-container, mat-snack-bar-container, .mat-mdc-snack-bar-container { display: none; }',
  });
  assertHighlightedTargetCaptured(image);
  await testInfo.attach('image', {
    body: image,
    contentType: 'image/png',
  });
  await testInfo.attach('image-caption', {
    body: caption,
  });

  for (const [index, locator] of focusPoints.entries()) {
    const highlightId = `docs-highlight-${index}`;
    try {
      await runWithRetry(async () => {
        const target = locator.first();
        await target.waitFor({ state: 'attached' });
        await target.evaluate((element, currentHighlightId) => {
          const highlightedElements = [
            element,
            ...Array.from(element.querySelectorAll('*')),
          ].filter(
            (candidate): candidate is HTMLElement =>
              candidate instanceof HTMLElement &&
              candidate.getAttribute('data-docs-highlight-target') ===
                currentHighlightId,
          );

          for (const htmlElement of highlightedElements) {
            htmlElement.style.outline =
              htmlElement.dataset['docsPrevOutline'] ?? '';
            htmlElement.style.zIndex =
              htmlElement.dataset['docsPrevZIndex'] ?? '';
            delete htmlElement.dataset['docsPrevOutline'];
            delete htmlElement.dataset['docsPrevZIndex'];
            htmlElement.removeAttribute('data-docs-highlight-target');
          }
        }, highlightId);
      });
    } catch (error) {
      if (!isDetachedError(error)) {
        throw error;
      }
    }
  }
}
