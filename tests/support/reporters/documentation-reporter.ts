import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from '@playwright/test/reporter';
import { ConfigProvider, Effect } from 'effect';
import path from 'node:path';

import { documentationOutputEnvironment } from '../config/environment';
import {
  assertNoUnsupportedDocumentationImageAttachments,
  buildSectionContent,
} from './documentation-reporter/attachments';
import { DocumentationGroupRegistry } from './documentation-reporter/group-registry';
import {
  DOCUMENTATION_ATTACHMENT_NAMES,
  ensureDirectory,
  stripTagsFromTitle,
  titleFromTestFile,
  writeFile,
} from './documentation-reporter/shared';

const readDocumentationEnvironment = () =>
  Effect.runSync(
    documentationOutputEnvironment.pipe(
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromEnv(),
      ),
    ),
  );

const figurePattern = /\{% figure src="([^"]+)" caption="([^"]*)"/gu;
const figureImageIdPattern = /(?:^|\/)image-(?<id>[a-f0-9]{16})\.[a-z0-9]+$/iu;

const assertUniqueFigureEvidence = (
  pageLines: string[],
  docTitle: string,
  runCaptions: Map<string, string>,
  runImageIds: Map<string, string>,
): void => {
  const seenSources = new Set<string>();
  const seenCaptions = new Set<string>();

  for (const line of pageLines) {
    for (const match of line.matchAll(figurePattern)) {
      const source = match[1];
      const caption = match[2];
      if (seenSources.has(source)) {
        throw new Error(
          `Generated documentation page ${docTitle} uses duplicate figure image ${source}. Each caption must point at distinct screenshot evidence.`,
        );
      }
      if (seenCaptions.has(caption)) {
        throw new Error(
          `Generated documentation page ${docTitle} uses duplicate figure caption "${caption}". Each screenshot needs a distinct caption that describes its own UI state.`,
        );
      }
      const imageId = source.match(figureImageIdPattern)?.groups?.id;
      const existingImageDocTitle = imageId
        ? runImageIds.get(imageId)
        : undefined;
      if (imageId && existingImageDocTitle) {
        throw new Error(
          `Generated documentation page ${docTitle} reuses figure image evidence image-${imageId} already used by ${existingImageDocTitle}. Each generated-doc screenshot must be distinct so one UI capture cannot claim unrelated states.`,
        );
      }
      const existingDocTitle = runCaptions.get(caption);
      if (existingDocTitle) {
        throw new Error(
          `Generated documentation page ${docTitle} uses duplicate figure caption "${caption}" already used by ${existingDocTitle}. Captions must stay unique across generated docs so one description cannot claim unrelated UI states.`,
        );
      }
      seenSources.add(source);
      seenCaptions.add(caption);
      if (imageId) runImageIds.set(imageId, docTitle);
      runCaptions.set(caption, docTitle);
    }
  }
};

class DocumentationReporter implements Reporter {
  private readonly environment = readDocumentationEnvironment();
  private readonly registry = new DocumentationGroupRegistry();

  constructor(private readonly options: { listOnly?: boolean } = {}) {}

  private get listOnly(): boolean {
    return this.options.listOnly ?? process.argv.includes('--list');
  }

  private docsRoot(options?: { empty?: boolean }): string {
    const root = this.environment.docsOutputDirectory;
    ensureDirectory(root, options);
    return root;
  }

  private imagesRoot(options?: { empty?: boolean }): string {
    const root = this.environment.docsImageOutputDirectory;
    ensureDirectory(root, options);
    return root;
  }

  onBegin(config: FullConfig, suite: Suite) {
    if (this.listOnly) {
      return;
    }

    this.registry.clear();
    this.registry.registerSuite(suite);

    const docs = this.docsRoot({ empty: true });
    const images = this.imagesRoot({ empty: true });
    console.log(`[docs-reporter] docsRoot=${docs} imagesRoot=${images}`);
  }

  onEnd(result: FullResult) {
    if (this.listOnly) {
      return;
    }

    const pages: Array<{
      folderName: string;
      pageLines: string[];
      title: string;
    }> = [];

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

      const pageLines: string[] = [
        `---\ntitle: ${JSON.stringify(mainTitle)}\n---`,
      ];
      for (const [index, section] of sections.entries()) {
        if (index > 0) pageLines.push('');
        if (hasMultipleTests) pageLines.push(`## ${section.title}`);
        pageLines.push(...section.content);
      }
      pages.push({
        folderName: doc.folderName,
        pageLines,
        title: mainTitle,
      });
    }

    const runCaptions = new Map<string, string>();
    const runImageIds = new Map<string, string>();
    for (const page of pages) {
      assertUniqueFigureEvidence(
        page.pageLines,
        page.title,
        runCaptions,
        runImageIds,
      );
    }

    for (const page of pages) {
      const pageDir = ensureDirectory(
        path.join(this.docsRoot(), page.folderName),
        {
          empty: true,
        },
      );
      writeFile(path.join(pageDir, 'page.md'), page.pageLines.join('\n'));
    }
  }

  onTestBegin(test: TestCase, result: TestResult) {}

  onTestEnd(test: TestCase, result: TestResult) {
    if (this.listOnly) {
      return;
    }
    if (result.status !== undefined && result.status !== 'passed') {
      return;
    }

    const relevantAttachments = result.attachments.filter((attachment) =>
      DOCUMENTATION_ATTACHMENT_NAMES.has(attachment.name),
    );
    if (relevantAttachments.length === 0) return;
    assertNoUnsupportedDocumentationImageAttachments(
      result.attachments,
      test.title,
    );

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
