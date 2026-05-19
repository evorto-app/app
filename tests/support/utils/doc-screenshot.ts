import { Locator, Page, TestInfo } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';

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
  await locator.first().screenshot({ path: absPath });

  // Return path relative to the images root
  return path.relative(imagesRoot, absPath);
}

// Keep compatibility with existing docs tests that import takeScreenshot from the reporter
export { takeScreenshot } from '../reporters/documentation-reporter';
