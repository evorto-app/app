import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import path from 'node:path';

import { buildSectionContent } from './documentation-reporter/attachments';
import { DocumentationGroupRegistry } from './documentation-reporter/group-registry';
import {
  DOCUMENTATION_ATTACHMENT_NAMES,
  ensureDirectory,
  stripTagsFromTitle,
  titleFromTestFile,
  writeFile,
} from './documentation-reporter/shared';

class DocumentationReporter implements Reporter {
  private readonly registry = new DocumentationGroupRegistry();

  private docsRoot(options?: { empty?: boolean }): string {
    const root = process.env.DOCS_OUT_DIR || path.resolve('test-results/docs');
    ensureDirectory(root, options);
    return root;
  }

  private imagesRoot(options?: { empty?: boolean }): string {
    const root =
      process.env.DOCS_IMG_OUT_DIR || path.resolve('test-results/docs/images');
    ensureDirectory(root, options);
    return root;
  }

  onBegin(config: FullConfig, suite: Suite) {
    this.registry.clear();
    this.registry.registerSuite(suite);

    const docs = this.docsRoot({ empty: true });
    const images = this.imagesRoot({ empty: true });
    console.log(`[docs-reporter] docsRoot=${docs} imagesRoot=${images}`);
  }

  onEnd(result: FullResult) {
    for (const doc of this.registry.getDocuments()) {
      if (doc.sections.length === 0) continue;

      const sections = [...doc.sections].sort((a, b) => {
        if (a.line !== b.line) return a.line - b.line;
        return a.title.localeCompare(b.title);
      });
      const hasMultipleTests = sections.length > 1;
      const mainTitle =
        doc.describeTitle ??
        (hasMultipleTests
          ? titleFromTestFile(doc.filePath ?? doc.folderName)
          : sections[0].title);

      const pageLines: string[] = [`---\ntitle: ${mainTitle}\n---`];
      for (const [index, section] of sections.entries()) {
        if (index > 0) pageLines.push('');
        if (hasMultipleTests) pageLines.push(`## ${section.title}`);
        pageLines.push(...section.content);
      }

      const pageDir = ensureDirectory(path.join(this.docsRoot(), doc.folderName), {
        empty: true,
      });
      writeFile(path.join(pageDir, 'page.md'), pageLines.join('\n'));
    }
  }

  onTestBegin(test: TestCase, result: TestResult) {}

  onTestEnd(test: TestCase, result: TestResult) {
    const relevantAttachments = result.attachments.filter((attachment) =>
      DOCUMENTATION_ATTACHMENT_NAMES.has(attachment.name),
    );
    if (relevantAttachments.length === 0) return;

    const groupInfo = this.registry.resolveForTest(test);
    const imagesDir = ensureDirectory(
      path.join(this.imagesRoot(), groupInfo.folderName),
    );
    const sectionContent = buildSectionContent(
      test,
      relevantAttachments,
      groupInfo.folderName,
      imagesDir,
    );

    this.registry.appendTestSection(test, {
      content: sectionContent,
      line: test.location?.line ?? Number.MAX_SAFE_INTEGER,
      title: stripTagsFromTitle(test.title) || 'Test',
    });
  }
}

export default DocumentationReporter;
export { takeScreenshot } from './documentation-reporter/take-screenshot';

