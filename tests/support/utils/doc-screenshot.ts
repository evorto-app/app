import { Locator, Page, TestInfo } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

const animationSettleTimeoutMs = 2_000;
const postAnimationSettleTimeoutMs = 250;
const snackbarSettleTimeoutMs = 750;

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function slugify(input: string) {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '')
      .slice(0, 64) || 'shot'
  );
}

export function resolveDocsImageOutputDirectory(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured = env['DOCS_IMG_OUT_DIR']?.trim();
  return configured && configured.length > 0
    ? configured
    : path.resolve('test-results/docs/images');
}

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
    await snackbar
      .waitFor({
        state: 'hidden',
        timeout: snackbarSettleTimeoutMs,
      })
      .catch(() => undefined);
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
  await page.waitForTimeout(postAnimationSettleTimeoutMs);
  await settleRenderFrame(page);
  await waitForLoadingIndicators(page);
  await waitForSnackbars(page);
};

/**
 * Focused documentation screenshot helper.
 * - Wraps Locator.screenshot and saves to DOCS_IMG_OUT_DIR (or default)
 * - Returns a relative PNG path (relative to the images root)
 */
export async function docScreenshot(
  testInfo: TestInfo,
  locator: Locator,
  _page: Page,
  name?: string,
): Promise<string> {
  const imagesRoot = resolveDocsImageOutputDirectory();
  ensureDir(imagesRoot);

  // organize by test folder for readability
  const testFolder = slugify(testInfo.title);
  const targetDir = path.join(imagesRoot, testFolder);
  ensureDir(targetDir);

  const base = slugify(name || 'screenshot');
  const stamp = Date.now().toString(36).slice(-6);
  const fileName = `${base}-${stamp}.png`;
  const absPath = path.join(targetDir, fileName);

  // Ensure the element is in view before taking the screenshot
  await locator.first().scrollIntoViewIfNeeded();
  await settleFiniteAnimations(_page);
  await locator.first().screenshot({
    animations: 'disabled',
    path: absPath,
    style:
      'mat-snack-bar-container, .mat-mdc-snack-bar-container { display: none; }',
  });

  // Return path relative to the images root
  return path.relative(imagesRoot, absPath);
}

// Keep compatibility with existing docs tests that import takeScreenshot from the reporter
export { takeScreenshot } from '../reporters/documentation-reporter';
