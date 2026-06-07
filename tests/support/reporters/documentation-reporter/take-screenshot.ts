import { Locator, Page, TestInfo } from '@playwright/test';
import { PNG } from 'pngjs';

const animationSettleTimeoutMs = 2_000;
const locatorSettleTimeoutMs = 1_500;
const snackbarSettleTimeoutMs = 750;
const highlightedTargetColor = { b: 153, g: 72, r: 236 };
const minimumHighlightedPixelCount = 16;
const minimumVisibleContentPixelCount = 128;
const minimumVisibleTextCharacterCount = 16;

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

export const countDocumentationContentPixels = (image: Buffer): number => {
  const png = (() => {
    try {
      return PNG.sync.read(image);
    } catch {
      return null;
    }
  })();
  let contentPixels = 0;

  if (!png) {
    return contentPixels;
  }

  for (let offset = 0; offset < png.data.length; offset += 4) {
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    const isHighlight =
      r === highlightedTargetColor.r &&
      g === highlightedTargetColor.g &&
      b === highlightedTargetColor.b;
    const isNearWhite = r >= 248 && g >= 248 && b >= 248;

    if (a > 0 && !isHighlight && !isNearWhite) {
      contentPixels += 1;
    }
  }

  return contentPixels;
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

const assertVisibleContentCaptured = (image: Buffer): void => {
  const contentPixels = countDocumentationContentPixels(image);

  if (contentPixels < minimumVisibleContentPixelCount) {
    throw new Error(
      'Documentation screenshots must include visible page content outside the highlighted focus target.',
    );
  }
};

const countVisibleViewportTextCharacters = async (
  page: Page,
): Promise<number> =>
  page.locator('body').evaluate((body) => {
    const isTransparentColor = (color: string): boolean => {
      const normalizedColor = color.replace(/\s+/gu, '').toLowerCase();

      return (
        normalizedColor === 'transparent' ||
        /rgba\([^)]*,0(?:\.0+)?\)$/u.test(normalizedColor) ||
        /rgb\([^)]*\/0(?:\.0+)?\)$/u.test(normalizedColor)
      );
    };
    const hasVisibleStyleChain = (element: Element): boolean => {
      let current: Element | null = element;

      while (current && current !== body) {
        const style = getComputedStyle(current);

        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          Number.parseFloat(style.opacity) <= 0
        ) {
          return false;
        }

        current = current.parentElement;
      }

      return true;
    };
    const hasReadableTextPaint = (element: Element): boolean => {
      const style = getComputedStyle(element);

      return (
        Number.parseFloat(style.fontSize) > 0 &&
        !isTransparentColor(style.color)
      );
    };
    const isVisibleInViewport = (element: Element): boolean => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        bounds.bottom > 0 &&
        bounds.right > 0 &&
        bounds.top < window.innerHeight &&
        bounds.left < window.innerWidth &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        Number.parseFloat(style.opacity) > 0 &&
        hasVisibleStyleChain(element) &&
        hasReadableTextPaint(element)
      );
    };
    const textWalker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const text = node.textContent?.replace(/\s+/gu, ' ').trim() ?? '';
        const parent = node.parentElement;

        if (
          !text ||
          !parent ||
          parent.closest('script, style, [data-docs-highlight-overlay]')
        ) {
          return NodeFilter.FILTER_REJECT;
        }

        return isVisibleInViewport(parent)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      },
    });
    let visibleText = '';
    let current = textWalker.nextNode();

    while (current) {
      visibleText = `${visibleText} ${current.textContent ?? ''}`;
      current = textWalker.nextNode();
    }

    return visibleText.replace(/\s+/gu, ' ').trim().length;
  });

const assertVisibleTextContentCaptured = async (page: Page): Promise<void> => {
  const visibleTextCharacters = await countVisibleViewportTextCharacters(page);

  if (visibleTextCharacters < minimumVisibleTextCharacterCount) {
    throw new Error(
      'Documentation screenshots must include readable visible UI text in the viewport.',
    );
  }
};

const hasVisibleLoadingIndicator = async (page: Page): Promise<boolean> =>
  page.locator('body').evaluate((body) => {
    const isVisible = (element: Element): boolean => {
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);

      return (
        bounds.width > 0 &&
        bounds.height > 0 &&
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        style.opacity !== '0'
      );
    };

    return [...body.querySelectorAll('*')].some((element) => {
      const text = [...element.childNodes]
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? '')
        .join(' ')
        .trim()
        .replace(/\s+/gu, ' ');

      return /^Loading\b.*$/u.test(text) && isVisible(element);
    });
  });

const waitForLoadingIndicators = async (page: Page): Promise<void> => {
  const isLoading = await hasVisibleLoadingIndicator(page).catch(
    ignoreTimeout(false),
  );

  if (isLoading) {
    await page.waitForFunction(
      () => {
        const isVisible = (element: Element): boolean => {
          const bounds = element.getBoundingClientRect();
          const style = getComputedStyle(element);

          return (
            bounds.width > 0 &&
            bounds.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            style.opacity !== '0'
          );
        };

        return ![...document.body.querySelectorAll('*')].some((element) => {
          const text = [...element.childNodes]
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent ?? '')
            .join(' ')
            .trim()
            .replace(/\s+/gu, ' ');

          return /^Loading\b.*$/u.test(text) && isVisible(element);
        });
      },
      undefined,
      { timeout: 15_000 },
    );
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

const assertUniqueScreenshotTarget = async (
  locator: Locator,
  index: number,
): Promise<void> => {
  await locator.first().waitFor({ state: 'attached' });

  const matchCount = await locator.count();

  if (matchCount !== 1) {
    throw new Error(
      `Documentation screenshots must target exactly one element per focus point; target ${index + 1} matched ${matchCount} elements. Narrow the locator before taking generated-doc screenshots so image evidence cannot silently capture an unrelated repeated card, row, or control.`,
    );
  }
};

export async function takeScreenshot(
  testInfo: TestInfo,
  locators: Locator | Locator[],
  page: Page,
  caption: string,
) {
  const captionWords = caption.trim().split(/\s+/u).filter(Boolean);

  if (caption.trim().length < 32 || captionWords.length < 5) {
    throw new Error(
      'Documentation screenshots require a descriptive caption of at least 32 characters and five words.',
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
    await runWithRetry(() => assertUniqueScreenshotTarget(locator, index));
  }

  for (const [index, locator] of focusPoints.entries()) {
    const highlightId = `docs-highlight-${index}`;
    await runWithRetry(async () => {
      const target = locator.first();
      await target.waitFor({ state: 'attached' });
      await target.evaluate((element, currentHighlightId) => {
        const highlightColor = 'rgb(236, 72, 153)';
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
        const createHighlightOverlay = () => {
          const bounds = htmlElement.getBoundingClientRect();
          const left = Math.max(0, bounds.left);
          const top = Math.max(0, bounds.top);
          const right = Math.min(window.innerWidth, bounds.right);
          const bottom = Math.min(window.innerHeight, bounds.bottom);
          const overlay = document.createElement('div');

          overlay.setAttribute(
            'data-docs-highlight-overlay',
            currentHighlightId,
          );
          overlay.style.position = 'fixed';
          overlay.style.left = `${left}px`;
          overlay.style.top = `${top}px`;
          overlay.style.width = `${Math.max(8, right - left)}px`;
          overlay.style.height = `${Math.max(8, bottom - top)}px`;
          overlay.style.border = `4px solid ${highlightColor}`;
          overlay.style.boxSizing = 'border-box';
          overlay.style.pointerEvents = 'none';
          overlay.style.zIndex = '2147483647';
          document.body.append(overlay);
        };

        htmlElement.setAttribute(
          'data-docs-highlight-target',
          currentHighlightId,
        );
        htmlElement.scrollIntoView({ behavior: 'instant', block: 'center' });
        htmlElement.dataset['docsPrevOutline'] =
          htmlElement.style.outline ?? '';
        htmlElement.dataset['docsPrevZIndex'] = htmlElement.style.zIndex ?? '';
        htmlElement.style.outline = `thick solid ${highlightColor}`;
        htmlElement.style.zIndex = '10000';
        createHighlightOverlay();
        return htmlElement;
      }, highlightId);
      await waitForStableLocator(page, target);
    });
  }

  await settleFiniteAnimations(page);
  await assertVisibleTextContentCaptured(page);
  for (const [index, locator] of focusPoints.entries()) {
    const highlightId = `docs-highlight-${index}`;
    await runWithRetry(async () => {
      const target = locator.first();
      await target.waitFor({ state: 'attached' });
      await target.evaluate((element, currentHighlightId) => {
        const highlightedElement = [
          element,
          ...Array.from(element.querySelectorAll('*')),
        ].find(
          (candidate): candidate is HTMLElement =>
            candidate instanceof HTMLElement &&
            candidate.getAttribute('data-docs-highlight-target') ===
              currentHighlightId,
        );

        if (!highlightedElement) {
          return;
        }

        document
          .querySelectorAll(
            `[data-docs-highlight-overlay="${currentHighlightId}"]`,
          )
          .forEach((overlay) => overlay.remove());

        const bounds = highlightedElement.getBoundingClientRect();
        const left = Math.max(0, bounds.left);
        const top = Math.max(0, bounds.top);
        const right = Math.min(window.innerWidth, bounds.right);
        const bottom = Math.min(window.innerHeight, bounds.bottom);
        const overlay = document.createElement('div');

        overlay.setAttribute('data-docs-highlight-overlay', currentHighlightId);
        overlay.style.position = 'fixed';
        overlay.style.left = `${left}px`;
        overlay.style.top = `${top}px`;
        overlay.style.width = `${Math.max(8, right - left)}px`;
        overlay.style.height = `${Math.max(8, bottom - top)}px`;
        overlay.style.border = '4px solid rgb(236, 72, 153)';
        overlay.style.boxSizing = 'border-box';
        overlay.style.pointerEvents = 'none';
        overlay.style.zIndex = '2147483647';
        document.body.append(overlay);
      }, highlightId);
    });
  }
  const image = await page.screenshot({
    animations: 'disabled',
    style:
      '.tsqd-parent-container, mat-snack-bar-container, .mat-mdc-snack-bar-container { display: none; }',
  });
  assertHighlightedTargetCaptured(image);
  assertVisibleContentCaptured(image);
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
          document
            .querySelectorAll(
              `[data-docs-highlight-overlay="${currentHighlightId}"]`,
            )
            .forEach((overlay) => overlay.remove());

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
