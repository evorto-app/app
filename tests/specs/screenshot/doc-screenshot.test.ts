import fs from 'node:fs';
import path from 'node:path';
import { expect } from '@playwright/test';

import { defaultStateFile } from '../../../helpers/user-data';
import { docScreenshot } from '../../support/utils/doc-screenshot';
import { test } from '../../support/fixtures/parallel-test';

// T023: Failing test for screenshot helper
// This defines the contract for the tests/support/utils/doc-screenshot.ts helper:
// - It should wrap Locator.screenshot (focused element capture)
// - It should return a relative image path (not absolute)
// - The returned path is relative to the images root (DOCS_IMG_OUT_DIR or default)

test.setTimeout(120000);

test.use({ storageState: defaultStateFile });

test('doc-screenshot returns a relative path and writes image', async ({
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

test('doc-screenshot waits for descriptive loading text before capture', async ({
  page,
}, testInfo) => {
  const imgRoot = path.resolve('test-results/tmp-doc-images-loading');
  process.env.DOCS_IMG_OUT_DIR = imgRoot;

  await page.setContent(`
    <main>
      <h1>Loading tax rates...</h1>
      <section id="target">Ready content</section>
      <script>
        setTimeout(() => {
          document.querySelector('h1').remove();
        }, 500);
      </script>
    </main>
  `);

  const startedAt = Date.now();
  const relPath = await docScreenshot(
    testInfo,
    page.locator('#target'),
    page,
    'loading-tax-rates',
  );

  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(400);
  expect(await page.getByText('Loading tax rates...').count()).toBe(0);
  expect(fs.existsSync(path.join(imgRoot, relPath))).toBe(true);
});

test('doc-screenshot waits for finite transitions before capture', async ({
  page,
}, testInfo) => {
  const imgRoot = path.resolve('test-results/tmp-doc-images-transition');
  process.env.DOCS_IMG_OUT_DIR = imgRoot;

  await page.setContent(`
    <style>
      #target {
        height: 80px;
        transform: translateX(80px);
        transition: transform 650ms linear;
        width: 240px;
      }

      #target.settled {
        transform: translateX(0);
      }
    </style>
    <section id="target">Animated documentation target</section>
    <script>
      requestAnimationFrame(() => {
        document.querySelector('#target').classList.add('settled');
      });
    </script>
  `);

  const startedAt = Date.now();
  const relPath = await docScreenshot(
    testInfo,
    page.locator('#target'),
    page,
    'transition-target',
  );

  const translateX = await page.locator('#target').evaluate((element) => {
    return new DOMMatrixReadOnly(getComputedStyle(element).transform).m41;
  });

  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(550);
  expect(translateX).toBe(0);
  expect(fs.existsSync(path.join(imgRoot, relPath))).toBe(true);
});
