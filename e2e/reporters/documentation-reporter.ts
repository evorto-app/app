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

// Helper functions to replace fs-jetpack functionality
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
  onBegin(config: FullConfig, suite: Suite) {
    // ensureDirectory(
    //   path.resolve(
    //     'C:/Users/hedde/source/repos/evorto/apps/documentation-page/public/docs',
    //   ),
    //   {
    //     empty: true,
    //   },
    // );
  }

  onEnd(result: FullResult) {
    // console.log(`Finished the run: ${result.status}`);
  }

  onTestBegin(test: TestCase, result: TestResult) {
    // console.log(`Starting test ${test.title}`);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    console.log(`Finished test ${test.title}: ${result.status}`);
    const testFolderName = test.title.toLowerCase().replaceAll(' ', '-');
    if (
      result.attachments.filter((attachment) =>
        ['image', 'image-caption', 'markdown'].includes(attachment.name),
      ).length === 0
    ) {
      return;
    }
    const testFolder = ensureDirectory(
      path.resolve(
        `C:/Users/hedde/code/evorto-pages/apps/documentation/src/app/docs/${testFolderName}`,
      ),
      { empty: true },
    );
    const picturesFolder = ensureDirectory(
      path.resolve(
        `C:/Users/hedde/code/evorto-pages/apps/documentation/public/docs/${testFolderName}`,
      ),
      { empty: true },
    );
    const fileContent = [`---\ntitle: ${test.title}\n---`];
    for (const attachment of result.attachments.filter((attachment) =>
      ['image', 'image-caption', 'markdown'].includes(attachment.name),
    )) {
      switch (attachment.name) {
        case 'image': {
          // Ensure body exists before using it
          if (!attachment.body) {
            console.warn(`Missing body for image attachment in ${test.title}`);
            continue;
          }

          // Generate hash based on image content instead of random ID
          const hash = crypto
            .createHash('sha256')
            .update(attachment.body)
            .digest('hex');
          // Use a shorter version of the hash to keep filenames reasonable
          const id = hash.slice(0, 16);

          writeFile(
            path.join(
              picturesFolder,
              `${attachment.name}-${id}.${attachment.contentType.split('/')[1]}`,
            ),
            attachment.body,
          );
          fileContent.push(
            `![${attachment.name}](${testFolderName}/${attachment.name}-${id}.${
              attachment.contentType.split('/')[1]
            })`,
          );
          break;
        }
        case 'markdown': {
          // Ensure body exists before using toString()
          if (!attachment.body) {
            console.warn(
              `Missing body for markdown attachment in ${test.title}`,
            );
            continue;
          }
          fileContent.push(attachment.body.toString());
          break;
        }
        case 'image-caption': {
          // Ensure body exists before using toString()
          if (!attachment.body) {
            console.warn(
              `Missing body for image-caption attachment in ${test.title}`,
            );
            continue;
          }

          // check last element
          const lastElement = fileContent.at(-1);
          if (!lastElement) {
            console.warn(`No elements to caption in ${test.title}`);
            continue;
          }

          const caption = attachment.body.toString();
          // check if last element is an image
          if (!lastElement.startsWith('![')) {
            console.warn(
              `Last element is not an image in ${test.title} for caption ${caption}`,
            );
            break;
          }
          // extract image url
          const imageUrl = lastElement.split('(')[1].split(')')[0];
          // insert figure
          fileContent[fileContent.length - 1] =
            `{% figure src="${imageUrl}" caption="${caption}" /%}`;
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
