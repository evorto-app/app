import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import DocumentationReporter from '../reporters/documentation-reporter';

test('documentation reporter respects DOCS_* env and writes files @track(playwright-specs-track-linking_20260126) @req(REPORTER-PATHS-TEST-01)', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out');
  const imgsRoot = testInfo.outputPath('docs-img');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // minimal begin
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  // create a fake test with attachments
  const title = 'Sample Journey';
  const slug = title.toLowerCase().replaceAll(' ', '-');
  const png = Buffer.from([137, 80, 78, 71]); // not a valid PNG, but enough for file write
  const result = {
    attachments: [
      {
        name: 'markdown',
        contentType: 'text/markdown',
        body: Buffer.from('Hello world'),
      },
      { name: 'image', contentType: 'image/png', body: png },
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from('An image'),
      },
    ],
  } as any;

  const testCase = { title } as any;
  reporter.onTestEnd(testCase, result);

  const mdPath = path.join(docsRoot, slug, 'page.md');
  expect(fs.existsSync(mdPath)).toBeTruthy();
  const md = fs.readFileSync(mdPath, 'utf-8');
  expect(md).toContain(`title: ${title}`);
  // image written into images root under slug folder
  const imgDir = path.join(imgsRoot, slug);
  const imgs = fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : [];
  expect(imgs.some((f) => f.endsWith('.png'))).toBeTruthy();
});

test('front matter normalization with permissions callout @track(playwright-specs-track-linking_20260126) @req(REPORTER-PATHS-TEST-02)', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out2');
  const imgsRoot = testInfo.outputPath('docs-img2');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error stubs
  reporter.onBegin({}, {});

  const title = 'Permissions Journey';
  const slug = title.toLowerCase().replaceAll(' ', '-');
  const mdBlock = `---\nPermissions:\n - admin:manage\n - events:view\n---\nBody text`;
  const result = {
    attachments: [
      {
        name: 'markdown',
        contentType: 'text/markdown',
        body: Buffer.from(mdBlock),
      },
    ],
  } as any;

  reporter.onTestEnd({ title } as any, result);

  const mdPath = path.join(docsRoot, slug, 'page.md');
  const md = fs.readFileSync(mdPath, 'utf-8');
  expect(md.startsWith('---\ntitle:')).toBeTruthy();
  expect(md).toContain('User permissions');
  expect(md).toContain('- admin:manage');
  expect(md).toContain('- events:view');
  expect(md).toContain('Body text');
});
