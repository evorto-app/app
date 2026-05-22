import { Locator, Page, TestInfo } from '@playwright/test';

const animationSettleTimeoutMs = 2_000;
const locatorSettleTimeoutMs = 1_500;
const snackbarSettleTimeoutMs = 7_000;

const waitForLoadingIndicators = async (page: Page): Promise<void> => {
  const loadingIndicator = page.getByText(/^Loading\b.*$/).first();
  const isLoading = await loadingIndicator
    .isVisible({ timeout: 250 })
    .catch(() => false);

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
    .catch(() => false);

  if (isVisible) {
    await snackbar.waitFor({
      state: 'hidden',
      timeout: snackbarSettleTimeoutMs,
    });
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
        new Promise((resolve) => setTimeout(resolve, 100)),
      ]);
    }
  }, animationSettleTimeoutMs);
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
  caption?: string,
) {
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

  for (const locator of focusPoints) {
    await runWithRetry(async () => {
      const target = locator.first();
      await target.waitFor({ state: 'attached' });
      await target.evaluate((element) => {
        const htmlElement = element as HTMLElement;
        htmlElement.scrollIntoView({ behavior: 'instant', block: 'center' });
        htmlElement.dataset['docsPrevOutline'] =
          htmlElement.style.outline ?? '';
        htmlElement.dataset['docsPrevZIndex'] = htmlElement.style.zIndex ?? '';
        htmlElement.style.outline = 'thick solid rgb(236, 72, 153)';
        htmlElement.style.zIndex = '10000';
        return htmlElement;
      });
      await waitForStableLocator(page, target);
    });
  }

  await settleFiniteAnimations(page);
  await testInfo.attach('image', {
    body: await page.screenshot({
      animations: 'disabled',
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
        throw error;
      }
    }
  }
}
