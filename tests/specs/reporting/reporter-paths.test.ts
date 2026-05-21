import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

import DocumentationReporter from '../../support/reporters/documentation-reporter';
import { resolveDocsImageOutputDirectory } from '../../support/utils/doc-screenshot';

test('documentation reporter respects DOCS_* env and writes files', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out');
  const imgsRoot = testInfo.outputPath('docs-img');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // minimal begin
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  // create a fake test with attachments
  const title =
    'Sample Journey: Discounts @finance @track(playwright-specs-track-linking_20260126) @req(REPORTER-PATHS-TEST-01)';
  const slug = 'sample-journey-discounts';
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
  // @ts-expect-error minimal stubs for types
  reporter.onEnd({});

  const mdPath = path.join(docsRoot, slug, 'page.md');
  expect(fs.existsSync(mdPath)).toBeTruthy();
  const md = fs.readFileSync(mdPath, 'utf-8');
  expect(md).toContain('title: "Sample Journey: Discounts"');
  expect(md).not.toContain('@track(');
  expect(md).not.toContain('@req(');
  // image written into images root under slug folder
  const imgDir = path.join(imgsRoot, slug);
  const imgs = fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : [];
  expect(imgs.some((f) => f.endsWith('.png'))).toBeTruthy();
});

test('doc screenshot helper resolves DOCS_IMG_OUT_DIR at call time', async ({}, testInfo) => {
  const previous = process.env.DOCS_IMG_OUT_DIR;
  const imgsRoot = testInfo.outputPath('docs-img-call-time');
  delete process.env.DOCS_IMG_OUT_DIR;

  try {
    expect(resolveDocsImageOutputDirectory()).toBe(
      path.resolve('test-results/docs/images'),
    );

    process.env.DOCS_IMG_OUT_DIR = imgsRoot;
    expect(resolveDocsImageOutputDirectory()).toBe(imgsRoot);
  } finally {
    if (previous === undefined) {
      delete process.env.DOCS_IMG_OUT_DIR;
    } else {
      process.env.DOCS_IMG_OUT_DIR = previous;
    }
  }
});

test('documentation reporter clears docs/image roots on begin', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out3');
  const imgsRoot = testInfo.outputPath('docs-img3');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const staleDocPath = path.join(docsRoot, 'stale', 'page.md');
  const staleImagePath = path.join(imgsRoot, 'stale', 'image.png');
  fs.mkdirSync(path.dirname(staleDocPath), { recursive: true });
  fs.mkdirSync(path.dirname(staleImagePath), { recursive: true });
  fs.writeFileSync(staleDocPath, 'stale doc');
  fs.writeFileSync(staleImagePath, 'stale image');

  const reporter = new DocumentationReporter();
  // @ts-expect-error stubs
  reporter.onBegin({}, {});

  expect(fs.existsSync(staleDocPath)).toBe(false);
  expect(fs.existsSync(staleImagePath)).toBe(false);
  expect(fs.existsSync(docsRoot)).toBe(true);
  expect(fs.existsSync(imgsRoot)).toBe(true);
});

test('documentation reporter leaves docs/image roots untouched in list-only mode', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out6');
  const imgsRoot = testInfo.outputPath('docs-img6');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const staleDocPath = path.join(docsRoot, 'stale', 'page.md');
  const staleImagePath = path.join(imgsRoot, 'stale', 'image.png');
  fs.mkdirSync(path.dirname(staleDocPath), { recursive: true });
  fs.mkdirSync(path.dirname(staleImagePath), { recursive: true });
  fs.writeFileSync(staleDocPath, 'stale doc');
  fs.writeFileSync(staleImagePath, 'stale image');

  const reporter = new DocumentationReporter({ listOnly: true });
  // @ts-expect-error stubs
  reporter.onBegin({}, {});
  // @ts-expect-error minimal stubs for types
  reporter.onEnd({});

  expect(fs.readFileSync(staleDocPath, 'utf-8')).toBe('stale doc');
  expect(fs.readFileSync(staleImagePath, 'utf-8')).toBe('stale image');
});

test('front matter normalization with permissions callout', async ({}, testInfo) => {
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
  // @ts-expect-error minimal stubs for types
  reporter.onEnd({});

  const mdPath = path.join(docsRoot, slug, 'page.md');
  const md = fs.readFileSync(mdPath, 'utf-8');
  expect(md.startsWith('---\ntitle: "Permissions Journey"')).toBeTruthy();
  expect(md).toContain('User permissions');
  expect(md).toContain('- admin:manage');
  expect(md).toContain('- events:view');
  expect(md).toContain('Body text');
});

test('documentation reporter emits one markdown file per describe block', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out4');
  const imgsRoot = testInfo.outputPath('docs-img4');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error stubs
  reporter.onBegin({}, {});

  const fakeFilePath =
    '/Users/hedde/code/evorto/tests/docs/events/register.doc.ts';
  const resultA = {
    attachments: [
      {
        name: 'markdown',
        contentType: 'text/markdown',
        body: Buffer.from('First section content'),
      },
    ],
  } as any;
  const resultB = {
    attachments: [
      {
        name: 'markdown',
        contentType: 'text/markdown',
        body: Buffer.from('Second section content'),
      },
    ],
  } as any;

  reporter.onTestEnd(
    {
      location: { file: fakeFilePath, line: 10 },
      titlePath: () => [
        '',
        'docs',
        fakeFilePath,
        'Registration docs',
        'Register for a free event',
      ],
      title:
        'Register for a free event @track(playwright-specs-track-linking_20260126) @doc(REGISTER-DOC-01)',
    } as any,
    resultA,
  );
  reporter.onTestEnd(
    {
      location: { file: fakeFilePath, line: 20 },
      titlePath: () => [
        '',
        'docs',
        fakeFilePath,
        'Registration docs',
        'Register for a paid event',
      ],
      title:
        'Register for a paid event @track(playwright-specs-track-linking_20260126) @doc(REGISTER-DOC-02)',
    } as any,
    resultB,
  );
  // @ts-expect-error stubs
  reporter.onEnd({});

  const mdPath = path.join(docsRoot, 'registration-docs', 'page.md');
  expect(fs.existsSync(mdPath)).toBe(true);
  const md = fs.readFileSync(mdPath, 'utf-8');
  expect(md).toContain('title: "Registration docs"');
  expect(md).toContain('## Register for a free event');
  expect(md).toContain('## Register for a paid event');
  expect(md).toContain('First section content');
  expect(md).toContain('Second section content');

  const entries = fs.readdirSync(docsRoot, { withFileTypes: true });
  const docDirectories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  expect(docDirectories).toEqual(['registration-docs']);
});

test('two tests in one describe block share one markdown file', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out5');
  const imgsRoot = testInfo.outputPath('docs-img5');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error stubs
  reporter.onBegin({}, {});

  const fakeFilePath =
    '/Users/hedde/code/evorto/tests/docs/events/checkout.doc.ts';
  const checkoutDescribe = 'Checkout flow docs';

  reporter.onTestEnd(
    {
      location: { file: fakeFilePath, line: 10 },
      titlePath: () => [
        '',
        'docs',
        fakeFilePath,
        checkoutDescribe,
        'Open checkout',
      ],
      title:
        'Open checkout @track(playwright-specs-track-linking_20260126) @doc(CHECKOUT-DOC-01)',
    } as any,
    {
      attachments: [
        {
          name: 'markdown',
          contentType: 'text/markdown',
          body: Buffer.from('Open checkout section'),
        },
      ],
    } as any,
  );

  reporter.onTestEnd(
    {
      location: { file: fakeFilePath, line: 20 },
      titlePath: () => [
        '',
        'docs',
        fakeFilePath,
        checkoutDescribe,
        'Confirm checkout payment',
      ],
      title:
        'Confirm checkout payment @track(playwright-specs-track-linking_20260126) @doc(CHECKOUT-DOC-02)',
    } as any,
    {
      attachments: [
        {
          name: 'markdown',
          contentType: 'text/markdown',
          body: Buffer.from('Confirm checkout section'),
        },
      ],
    } as any,
  );
  // @ts-expect-error stubs
  reporter.onEnd({});

  const mdPath = path.join(docsRoot, 'checkout-flow-docs', 'page.md');
  expect(fs.existsSync(mdPath)).toBe(true);
  const md = fs.readFileSync(mdPath, 'utf-8');
  expect(md).toContain('title: "Checkout flow docs"');
  expect(md).toContain('## Open checkout');
  expect(md).toContain('## Confirm checkout payment');
  expect(md).toContain('Open checkout section');
  expect(md).toContain('Confirm checkout section');

  const docDirectories = fs
    .readdirSync(docsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  expect(docDirectories).toEqual(['checkout-flow-docs']);
});
