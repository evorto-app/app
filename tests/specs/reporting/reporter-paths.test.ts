import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

import DocumentationReporter from '../../support/reporters/documentation-reporter';
import {
  countDocumentationContentPixels,
  countDocumentationHighlightPixels,
  takeScreenshot,
} from '../../support/reporters/documentation-reporter/take-screenshot';
import { resolveDocsImageOutputDirectory } from '../../support/utils/doc-screenshot';

const createDocumentationEvidencePng = ({
  height = 240,
  includeContent = true,
  includeHighlight = true,
  width = 360,
}: {
  height?: number;
  includeContent?: boolean;
  includeHighlight?: boolean;
  width?: number;
} = {}): Buffer => {
  const png = new PNG({ height, width });
  png.data.fill(255);

  if (includeContent) {
    for (let y = 24; y < 40; y += 1) {
      for (let x = 24; x < 40; x += 1) {
        const offset = (y * png.width + x) * 4;
        png.data[offset] = 30;
        png.data[offset + 1] = 64;
        png.data[offset + 2] = 175;
        png.data[offset + 3] = 255;
      }
    }
  }

  if (includeHighlight) {
    for (let y = 8; y < 16; y += 1) {
      for (let x = 8; x < 16; x += 1) {
        const offset = (y * png.width + x) * 4;
        png.data[offset] = 236;
        png.data[offset + 1] = 72;
        png.data[offset + 2] = 153;
        png.data[offset + 3] = 255;
      }
    }
  }

  return PNG.sync.write(png);
};

const descriptiveMarkdown =
  'This generated guide section explains the visible workflow state and why the captured UI matters for product documentation.';

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
  const png = createDocumentationEvidencePng();
  const result = {
    attachments: [
      {
        name: 'markdown',
        contentType: 'text/markdown',
        body: Buffer.from(descriptiveMarkdown),
      },
      { name: 'image', contentType: 'image/png', body: png },
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from(
          'Discount cards section showing "active" & pending states',
        ),
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
  expect(md).toContain('{% figure src="sample-journey-discounts/image-');
  expect(md).toContain(
    'caption="Discount cards section showing &quot;active&quot; &amp; pending states" /%}',
  );
  expect(md).not.toContain('@track(');
  expect(md).not.toContain('@req(');
  // image written into images root under slug folder
  const imgDir = path.join(imgsRoot, slug);
  const imgs = fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : [];
  expect(imgs.some((f) => f.endsWith('.png'))).toBeTruthy();
});

test('documentation reporter rejects uncaptioned image attachments', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-uncaptioned');
  const imgsRoot = testInfo.outputPath('docs-img-uncaptioned');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const result = {
    attachments: [
      {
        name: 'image',
        contentType: 'image/png',
        body: createDocumentationEvidencePng(),
      },
    ],
  } as any;

  expect(() =>
    reporter.onTestEnd({ title: 'Uncaptioned image' } as any, result),
  ).toThrow(
    'Documentation image attachment in Uncaptioned image is missing a paired image-caption attachment.',
  );
});

test('documentation reporter rejects invalid image attachments', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-invalid-image');
  const imgsRoot = testInfo.outputPath('docs-img-invalid-image');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const result = {
    attachments: [
      {
        name: 'image',
        contentType: 'image/png',
        body: Buffer.from([137, 80, 78, 71]),
      },
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from('Invalid image should fail before markdown output'),
      },
    ],
  } as any;

  expect(() =>
    reporter.onTestEnd({ title: 'Invalid image' } as any, result),
  ).toThrow(
    'Documentation image attachment in Invalid image must be a valid PNG screenshot.',
  );
});

test('documentation reporter rejects undersized image attachments', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-undersized-image');
  const imgsRoot = testInfo.outputPath('docs-img-undersized-image');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const result = {
    attachments: [
      {
        name: 'image',
        contentType: 'image/png',
        body: createDocumentationEvidencePng({ height: 64, width: 64 }),
      },
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from('Tiny highlighted screenshot should fail dimensions'),
      },
    ],
  } as any;

  expect(() =>
    reporter.onTestEnd({ title: 'Undersized image' } as any, result),
  ).toThrow(
    'Documentation image attachment in Undersized image must be at least 320x240px so generated docs show enough UI context to judge the captured state.',
  );
});

test('documentation reporter rejects images without a highlighted target', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-missing-highlight');
  const imgsRoot = testInfo.outputPath('docs-img-missing-highlight');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const result = {
    attachments: [
      {
        name: 'image',
        contentType: 'image/png',
        body: createDocumentationEvidencePng({ includeHighlight: false }),
      },
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from(
          'Unhighlighted image should fail documentation evidence',
        ),
      },
    ],
  } as any;

  expect(() =>
    reporter.onTestEnd({ title: 'Missing highlighted target' } as any, result),
  ).toThrow(
    'Documentation image attachment in Missing highlighted target must include the highlighted focus target.',
  );
});

test('documentation reporter rejects images without surrounding page content', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-missing-content');
  const imgsRoot = testInfo.outputPath('docs-img-missing-content');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const result = {
    attachments: [
      {
        name: 'image',
        contentType: 'image/png',
        body: createDocumentationEvidencePng({ includeContent: false }),
      },
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from(
          'Context-free image should fail documentation evidence',
        ),
      },
    ],
  } as any;

  expect(() =>
    reporter.onTestEnd({ title: 'Missing page context' } as any, result),
  ).toThrow(
    'Documentation image attachment in Missing page context must include visible page content outside the highlighted focus target.',
  );
});

test('documentation reporter rejects orphan image-caption attachments', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-orphan-caption');
  const imgsRoot = testInfo.outputPath('docs-img-orphan-caption');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const result = {
    attachments: [
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from('Caption without an image attachment'),
      },
    ],
  } as any;

  expect(() =>
    reporter.onTestEnd({ title: 'Orphan caption' } as any, result),
  ).toThrow(
    'Documentation image-caption attachment in Orphan caption is missing a preceding image attachment.',
  );
});

test('documentation reporter rejects weak image captions at output time', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-weak-caption');
  const imgsRoot = testInfo.outputPath('docs-img-weak-caption');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const result = {
    attachments: [
      {
        name: 'image',
        contentType: 'image/png',
        body: createDocumentationEvidencePng(),
      },
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from('Too short'),
      },
    ],
  } as any;

  expect(() =>
    reporter.onTestEnd({ title: 'Weak reporter caption' } as any, result),
  ).toThrow(
    'Documentation image-caption attachment in Weak reporter caption must be a descriptive caption of at least 32 characters and five words.',
  );
});

test('documentation reporter rejects raw markdown image syntax', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-raw-markdown-image');
  const imgsRoot = testInfo.outputPath('docs-img-raw-markdown-image');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const result = {
    attachments: [
      {
        name: 'markdown',
        contentType: 'text/markdown',
        body: Buffer.from(
          'This product guide must not embed ![unrelated evidence](../raw.png).',
        ),
      },
    ],
  } as any;

  expect(() =>
    reporter.onTestEnd({ title: 'Raw markdown image' } as any, result),
  ).toThrow(
    'Documentation markdown attachment in Raw markdown image must not include raw Markdown image syntax or HTML <img> tags.',
  );
});

test('documentation reporter rejects weak markdown body text', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-weak-markdown-body');
  const imgsRoot = testInfo.outputPath('docs-img-weak-markdown-body');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const result = {
    attachments: [
      {
        name: 'markdown',
        contentType: 'text/markdown',
        body: Buffer.from('Too short.'),
      },
    ],
  } as any;

  expect(() =>
    reporter.onTestEnd({ title: 'Weak markdown body' } as any, result),
  ).toThrow(
    'Documentation markdown attachment in Weak markdown body must include at least 60 characters of explanatory body text so generated docs can be judged without clicking through the app.',
  );
});

test('documentation reporter rejects raw HTML image tags', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-raw-html-image');
  const imgsRoot = testInfo.outputPath('docs-img-raw-html-image');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const result = {
    attachments: [
      {
        name: 'markdown',
        contentType: 'text/markdown',
        body: Buffer.from(
          'This product guide must not embed <img src="../raw.png" alt="Unrelated evidence">.',
        ),
      },
    ],
  } as any;

  expect(() =>
    reporter.onTestEnd({ title: 'Raw HTML image' } as any, result),
  ).toThrow(
    'Documentation markdown attachment in Raw HTML image must not include raw Markdown image syntax or HTML <img> tags.',
  );
});

test('documentation reporter rejects duplicate figure image sources', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-duplicate-image-source');
  const imgsRoot = testInfo.outputPath('docs-img-duplicate-image-source');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const duplicatePng = createDocumentationEvidencePng();
  const result = {
    attachments: [
      {
        name: 'image',
        contentType: 'image/png',
        body: duplicatePng,
      },
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from(
          'First repeated screenshot caption with useful context',
        ),
      },
      {
        name: 'image',
        contentType: 'image/png',
        body: duplicatePng,
      },
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from(
          'Second repeated screenshot caption with different context',
        ),
      },
    ],
  } as any;

  reporter.onTestEnd({ title: 'Duplicate figure image source' } as any, result);

  expect(() =>
    // @ts-expect-error minimal stubs for types
    reporter.onEnd({}),
  ).toThrow(
    'Generated documentation page Duplicate figure image source uses duplicate figure image duplicate-figure-image-source/image-',
  );
});

test('documentation reporter rejects duplicate figure captions', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-duplicate-caption');
  const imgsRoot = testInfo.outputPath('docs-img-duplicate-caption');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const secondPng = PNG.sync.read(createDocumentationEvidencePng());
  const offset = (48 * secondPng.width + 48) * 4;
  secondPng.data[offset] = 20;
  secondPng.data[offset + 1] = 20;
  secondPng.data[offset + 2] = 20;
  secondPng.data[offset + 3] = 255;

  const repeatedCaption =
    'Repeated caption should fail generated documentation output';
  const result = {
    attachments: [
      {
        name: 'image',
        contentType: 'image/png',
        body: createDocumentationEvidencePng(),
      },
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from(repeatedCaption),
      },
      {
        name: 'image',
        contentType: 'image/png',
        body: PNG.sync.write(secondPng),
      },
      {
        name: 'image-caption',
        contentType: 'text/plain',
        body: Buffer.from(repeatedCaption),
      },
    ],
  } as any;

  reporter.onTestEnd({ title: 'Duplicate figure caption' } as any, result);

  expect(() =>
    // @ts-expect-error minimal stubs for types
    reporter.onEnd({}),
  ).toThrow(
    `Generated documentation page Duplicate figure caption uses duplicate figure caption "${repeatedCaption}"`,
  );
});

test('documentation reporter rejects duplicate figure captions across docs', async ({}, testInfo) => {
  const docsRoot = testInfo.outputPath('docs-out-duplicate-caption-run');
  const imgsRoot = testInfo.outputPath('docs-img-duplicate-caption-run');
  process.env.DOCS_OUT_DIR = docsRoot;
  process.env.DOCS_IMG_OUT_DIR = imgsRoot;

  const reporter = new DocumentationReporter();
  // @ts-expect-error minimal stubs for types
  reporter.onBegin({}, {});

  const secondPng = PNG.sync.read(createDocumentationEvidencePng());
  const offset = (52 * secondPng.width + 52) * 4;
  secondPng.data[offset] = 10;
  secondPng.data[offset + 1] = 10;
  secondPng.data[offset + 2] = 10;
  secondPng.data[offset + 3] = 255;

  const repeatedCaption = 'Repeated cross document caption should fail output';

  reporter.onTestEnd(
    { title: 'First duplicate caption document' } as any,
    {
      attachments: [
        {
          name: 'image',
          contentType: 'image/png',
          body: createDocumentationEvidencePng(),
        },
        {
          name: 'image-caption',
          contentType: 'text/plain',
          body: Buffer.from(repeatedCaption),
        },
      ],
    } as any,
  );
  reporter.onTestEnd(
    { title: 'Second duplicate caption document' } as any,
    {
      attachments: [
        {
          name: 'image',
          contentType: 'image/png',
          body: PNG.sync.write(secondPng),
        },
        {
          name: 'image-caption',
          contentType: 'text/plain',
          body: Buffer.from(repeatedCaption),
        },
      ],
    } as any,
  );

  expect(() =>
    // @ts-expect-error minimal stubs for types
    reporter.onEnd({}),
  ).toThrow(
    `Generated documentation page Second duplicate caption document uses duplicate figure caption "${repeatedCaption}" already used by First duplicate caption document`,
  );
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

test('documentation screenshot helper rejects weak runtime captions', async ({
  page,
}, testInfo) => {
  await page.setContent(`
    <main>
      <section id="target">Documented UI state</section>
    </main>
  `);

  await expect(
    takeScreenshot(testInfo, page.locator('#target'), page, 'Too short'),
  ).rejects.toThrow(
    'Documentation screenshots require a descriptive caption of at least 32 characters and five words.',
  );
});

test('documentation screenshot helper captures the highlighted target', async ({
  page,
}, testInfo) => {
  await page.setContent(`
    <main>
      <section id="target" style="margin: 48px; padding: 24px;">
        Documented UI state with enough visible content
      </section>
    </main>
  `);

  await takeScreenshot(
    testInfo,
    page.locator('#target'),
    page,
    'Highlighted documentation target inside the generated screenshot',
  );

  const imageAttachment = testInfo.attachments.find(
    (attachment) => attachment.name === 'image',
  );

  expect(imageAttachment?.body).toBeInstanceOf(Buffer);
  expect(
    countDocumentationHighlightPixels(imageAttachment?.body ?? Buffer.alloc(0)),
  ).toBeGreaterThanOrEqual(16);
  expect(
    countDocumentationContentPixels(imageAttachment?.body ?? Buffer.alloc(0)),
  ).toBeGreaterThanOrEqual(128);
});

test('documentation screenshot helper waits for all visible loading text', async ({
  page,
}, testInfo) => {
  await page.setContent(`
    <main>
      <h1 style="display: none">Loading hidden stale state...</h1>
      <h2>Loading generated documentation...</h2>
      <section id="target" style="margin: 48px; padding: 24px;">
        Documented UI state after loading settles
      </section>
      <script>
        setTimeout(() => {
          document.querySelector('h2').remove();
        }, 500);
      </script>
    </main>
  `);

  const startedAt = Date.now();
  await takeScreenshot(
    testInfo,
    page.locator('#target'),
    page,
    'Settled documentation target after loading indicator clears',
  );

  expect(Date.now() - startedAt).toBeGreaterThanOrEqual(400);
  await expect(
    page.getByText('Loading generated documentation...'),
  ).toHaveCount(0);
  await expect(page.getByText('Loading hidden stale state...')).toHaveCount(1);
});

test('documentation screenshot helper highlights a visible child for zero-box hosts', async ({
  page,
}, testInfo) => {
  await page.setContent(`
    <main>
      <app-doc-host style="display: contents;">
        <section id="target" style="margin: 48px; padding: 24px;">
          Documented UI state rendered inside a component host
        </section>
      </app-doc-host>
    </main>
  `);

  await takeScreenshot(
    testInfo,
    page.locator('app-doc-host'),
    page,
    'Highlighted child element inside a zero-box documentation host',
  );

  const imageAttachment = testInfo.attachments.find(
    (attachment) => attachment.name === 'image',
  );

  expect(imageAttachment?.body).toBeInstanceOf(Buffer);
  expect(
    countDocumentationHighlightPixels(imageAttachment?.body ?? Buffer.alloc(0)),
  ).toBeGreaterThanOrEqual(16);
  await expect(page.locator('#target')).not.toHaveAttribute(
    'data-docs-highlight-target',
    /.+/u,
  );
  await expect(page.locator('[data-docs-highlight-overlay]')).toHaveCount(0);
});

test('documentation screenshot helper rejects captures without visible page content', async ({
  page,
}, testInfo) => {
  await page.setContent(`
    <main>
      <section id="target">Documented UI state</section>
    </main>
  `);
  const originalScreenshot = page.screenshot.bind(page);
  const png = new PNG({ height: 64, width: 64 });
  png.data.fill(255);
  for (let y = 8; y < 16; y += 1) {
    for (let x = 8; x < 16; x += 1) {
      const offset = (y * png.width + x) * 4;
      png.data[offset] = 236;
      png.data[offset + 1] = 72;
      png.data[offset + 2] = 153;
      png.data[offset + 3] = 255;
    }
  }
  const blankHighlightedPng = PNG.sync.write(png);
  const pageWithScreenshotOverride = page as typeof page & {
    screenshot: () => Promise<Buffer>;
  };
  pageWithScreenshotOverride.screenshot = async () => blankHighlightedPng;

  try {
    expect(
      countDocumentationHighlightPixels(blankHighlightedPng),
    ).toBeGreaterThanOrEqual(16);
    expect(countDocumentationContentPixels(blankHighlightedPng)).toBe(0);
    await expect(
      takeScreenshot(
        testInfo,
        page.locator('#target'),
        page,
        'Blank highlighted documentation screenshot should fail content check',
      ),
    ).rejects.toThrow(
      'Documentation screenshots must include visible page content outside the highlighted focus target.',
    );
  } finally {
    pageWithScreenshotOverride.screenshot = originalScreenshot;
  }
});

test('documentation screenshot helper rejects captures without the highlighted target', async ({
  page,
}, testInfo) => {
  await page.setContent(`
    <main>
      <section id="target">Documented UI state</section>
    </main>
  `);
  const originalScreenshot = page.screenshot.bind(page);
  const pageWithScreenshotOverride = page as typeof page & {
    screenshot: () => Promise<Buffer>;
  };
  pageWithScreenshotOverride.screenshot = async () =>
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lD0SQwAAAABJRU5ErkJggg==',
      'base64',
    );

  try {
    await expect(
      takeScreenshot(
        testInfo,
        page.locator('#target'),
        page,
        'Missing highlighted documentation target should fail capture',
      ),
    ).rejects.toThrow(
      'Documentation screenshots must include the highlighted focus target.',
    );
  } finally {
    pageWithScreenshotOverride.screenshot = originalScreenshot;
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
  const mdBlock = `---\nPermissions:\n - admin:manage\n - events:view\n---\n${descriptiveMarkdown}`;
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
  expect(md).toContain(descriptiveMarkdown);
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
        body: Buffer.from(
          'First section content explains the opening registration docs state with enough detail for generated documentation review.',
        ),
      },
    ],
  } as any;
  const resultB = {
    attachments: [
      {
        name: 'markdown',
        contentType: 'text/markdown',
        body: Buffer.from(
          'Second section content explains the paid registration docs state with enough detail for generated documentation review.',
        ),
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
          body: Buffer.from(
            'Open checkout section explains the first checkout step with enough detail for generated documentation review.',
          ),
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
          body: Buffer.from(
            'Confirm checkout section explains payment confirmation with enough detail for generated documentation review.',
          ),
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
