import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';

import { defaultStateFile } from '../../helpers/user-data';
import { docScreenshot } from '../utils/doc-screenshot';
import { test } from '../fixtures/parallel-test';

// T023: Failing test for screenshot helper
// This defines the contract for the upcoming tests/utils/doc-screenshot.ts helper:
// - It should wrap Locator.screenshot (focused element capture)
// - It should return a relative image path (not absolute)
// - The returned path is relative to the images root (DOCS_IMG_OUT_DIR or default)

test.setTimeout(120000);

test.use({ storageState: defaultStateFile });

test('doc-screenshot returns a relative path and writes image @track(playwright-specs-track-linking_20260126) @req(DOC-SCREENSHOT-TEST-01)', async ({
  page,
}, testInfo) => {
  // Put images into a predictable temp folder for the test
  const imgRoot = path.resolve('test-results/tmp-doc-images');
  process.env.DOCS_IMG_OUT_DIR = imgRoot;

  await page.goto('.');
  const target = page.locator('body');

  const relPath = await docScreenshot(testInfo, target, page, 'home-body');

  // Assert it returns a relative path (no leading slash or drive letter)
  expect(typeof relPath).toBe('string');
  expect(relPath.length).toBeGreaterThan(0);
  expect(path.isAbsolute(relPath)).toBe(false);
  expect(/\.png$/i.test(relPath)).toBe(true);

  // And the file exists under the configured images root
  const absPath = path.join(imgRoot, relPath);
  expect(fs.existsSync(absPath)).toBe(true);
});
