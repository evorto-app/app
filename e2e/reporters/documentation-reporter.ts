import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { Locator, Page, TestInfo } from '@playwright/test';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import path from 'node:path';

// Helpers
const ensureDirectory = (
  directoryPath: string,
  options?: { empty?: boolean },
) => {
  if (options?.empty && fs.existsSync(directoryPath)) {
    fs.rmSync(directoryPath, { force: true, recursive: true });
  }
  fs.mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
};

const writeFile = (filePath: string, content: Buffer | string) => {
  fs.writeFileSync(filePath, content);
  return filePath;
};

class DocumentationReporter implements Reporter {
  private docsRoot(): string {
    const root = process.env.DOCS_OUT_DIR || path.resolve('test-results/docs');
    ensureDirectory(root);
    return root;
  }

  private imagesRoot(): string {
    const root =
      process.env.DOCS_IMG_OUT_DIR || path.resolve('test-results/docs/images');
    ensureDirectory(root);
    return root;
  }

  onBegin(config: FullConfig, suite: Suite) {
    const docs = this.docsRoot();
    const imgs = this.imagesRoot();
    console.log(`[docs-reporter] docsRoot=${docs} imagesRoot=${imgs}`);
  }

  onEnd(result: FullResult) {}
  onTestBegin(test: TestCase, result: TestResult) {}

  onTestEnd(test: TestCase, result: TestResult) {
    const testFolderName = test.title.toLowerCase().replaceAll(' ', '-');
    const relevant = result.attachments.filter((a) =>
      ['image', 'image-caption', 'markdown', 'permissions'].includes(a.name),
    );
    if (relevant.length === 0) return;

    const testFolder = ensureDirectory(
      path.join(this.docsRoot(), testFolderName),
      { empty: true },
    );
    const picturesFolder = ensureDirectory(
      path.join(this.imagesRoot(), testFolderName),
      { empty: true },
    );

    const fileContent: string[] = [`---\ntitle: ${test.title}\n---`];

    // collect permissions lines from attachment and/or front matter in markdown
    const permissionsLines: string[] = [];
    const permissionsAttachment = relevant.find((a) => a.name === 'permissions');
    if (permissionsAttachment?.body) {
      const raw = permissionsAttachment.body.toString();
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed) permissionsLines.push(trimmed);
      }
    }

    for (const attachment of relevant) {
      switch (attachment.name) {
        case 'image': {
          if (!attachment.body) {
            console.warn(`Missing body for image attachment in ${test.title}`);
            continue;
          }
          const hash = crypto.createHash('sha256').update(attachment.body).digest('hex');
          const id = hash.slice(0, 16);
          const ext = attachment.contentType.split('/')[1] || 'png';
          const imgName = `${attachment.name}-${id}.${ext}`;
          writeFile(path.join(picturesFolder, imgName), attachment.body);
          fileContent.push(`![${attachment.name}](${testFolderName}/${imgName})`);
          break;
        }
        case 'image-caption': {
          if (!attachment.body) {
            console.warn(`Missing body for image-caption in ${test.title}`);
            continue;
          }
          const last = fileContent.at(-1) ?? '';
          if (!last.startsWith('![')) break;
          const imageUrl = last.split('(')[1]?.split(')')[0] ?? '';
          const caption = attachment.body.toString();
          fileContent[fileContent.length - 1] = `{% figure src="${imageUrl}" caption="${caption}" /%}`;
          break;
        }
        case 'markdown': {
          if (!attachment.body) {
            console.warn(`Missing body for markdown in ${test.title}`);
            continue;
          }
          const text = attachment.body.toString();
          const fmMatch = text.match(/^---[\s\S]*?---\s*/);
          let body = text;
          if (fmMatch) {
            const fm = fmMatch[0];
            // collect leading list items as permissions lines
            for (const line of fm.split(/\r?\n/)) {
              const m = line.match(/^\s*-\s*(.+)$/);
              if (m) permissionsLines.push(m[1]);
            }
            body = text.slice(fm.length);
          }
          if (permissionsLines.length) {
            fileContent.push(
              '{% callout type="note" title="User permissions" %}',
              ...permissionsLines.map((p) => `- ${p}`),
              '{% /callout %}',
              '',
            );
          }
          fileContent.push(body.trim());
          break;
        }
        case 'permissions': {
          // handled above
          break;
        }
      }
    }

    writeFile(path.join(testFolder, 'page.md'), fileContent.join('\n'));
  }
}

export default DocumentationReporter;

export async function takeScreenshot(
  testInfo: TestInfo,
  locators: Locator | Locator[],
  page: Page,
  caption?: string,
) {
  // let boxShadow = 'none';
  let zIndex = '1';
  await page.waitForTimeout(1000);
  const focusPoints = Array.isArray(locators) ? locators : [locators];
  await Promise.all(
    focusPoints.map(async (locator) => {
      await locator.first().evaluate((element) => {
        // boxShadow = element.style.boxShadow;
        zIndex = element.style.zIndex;
        element.style.outline = 'thick solid rgb(236, 72, 153)';
        element.style.zIndex = '10000';
        return element;
      });
      await locator.first().scrollIntoViewIfNeeded();
    }),
  );
  await testInfo.attach('image', {
    body: await page.screenshot({
      style: '.tsqd-parent-container { display: none; }',
    }),
    contentType: 'image/png',
  });
  if (caption) {
    await testInfo.attach('image-caption', {
      body: caption,
    });
  }
  await Promise.all(
    focusPoints.map(async (locator) => {
      await locator.first().evaluate((element) => {
        element.style.zIndex = zIndex;
        // element.style.boxShadow = boxShadow;
        element.style.outline = 'none';
        return element;
      });
    }),
  );
}
