import type { Suite, TestCase } from '@playwright/test/reporter';

import {
  findFileSegmentIndex,
  MAX_FOLDER_NAME_LENGTH,
  slugifyFolderNameFromTitle,
  slugifyTestTitle,
  stripTagsFromTitle,
  type TestGroupDocument,
  type TestGroupInfo,
  type TestSection,
} from './shared';

export class DocumentationGroupRegistry {
  private readonly docsByGroup = new Map<string, TestGroupDocument>();
  private readonly folderNameCounts = new Map<string, number>();
  private readonly testLookupToGroupInfo = new Map<string, TestGroupInfo>();

  clear() {
    this.docsByGroup.clear();
    this.folderNameCounts.clear();
    this.testLookupToGroupInfo.clear();
  }

  registerSuite(suite: Suite) {
    if (typeof suite.allTests !== 'function') return;
    for (const test of suite.allTests()) {
      this.registerTestGroup(test);
    }
  }

  resolveForTest(test: TestCase): TestGroupInfo {
    const lookupKey = this.getTestLookupKey(test);
    const existing = this.testLookupToGroupInfo.get(lookupKey);
    return existing ?? this.registerTestGroup(test);
  }

  appendTestSection(test: TestCase, section: TestSection) {
    const info = this.resolveForTest(test);
    const doc = this.ensureGroupDocument(info);
    doc.sections.push(section);
    return info;
  }

  getDocuments(): TestGroupDocument[] {
    return [...this.docsByGroup.values()];
  }

  private getTestLookupKey(test: TestCase): string {
    return (
      test.id ??
      `${test.location?.file ?? 'unknown'}:${test.location?.line ?? -1}:${test.title}`
    );
  }

  private ensureGroupDocument(info: TestGroupInfo): TestGroupDocument {
    const existing = this.docsByGroup.get(info.groupKey);
    if (existing) return existing;
    const created: TestGroupDocument = {
      describeTitle: info.describeTitle,
      filePath: info.filePath,
      folderName: info.folderName,
      sections: [],
    };
    this.docsByGroup.set(info.groupKey, created);
    return created;
  }

  private registerTestGroup(test: TestCase): TestGroupInfo {
    const lookupKey = this.getTestLookupKey(test);
    const existingLookup = this.testLookupToGroupInfo.get(lookupKey);
    if (existingLookup) return existingLookup;

    const resolvedInfo = this.resolveGroupInfoFromTest(test);
    const existingGroup = this.docsByGroup.get(resolvedInfo.groupKey);
    const info: TestGroupInfo = existingGroup
      ? { ...resolvedInfo, folderName: existingGroup.folderName }
      : {
          ...resolvedInfo,
          folderName: this.allocateFolderName(resolvedInfo.folderName),
        };

    this.testLookupToGroupInfo.set(lookupKey, info);
    this.ensureGroupDocument(info);
    return info;
  }

  private resolveGroupInfoFromTest(test: TestCase): TestGroupInfo {
    const sanitizedTitle = stripTagsFromTitle(test.title) || 'Test';
    let filePath = test.location?.file;
    const describeTitles: string[] = [];

    let suiteCursor = test.parent;
    while (suiteCursor) {
      if (suiteCursor.type === 'file' && !filePath) {
        filePath = suiteCursor.title;
      }
      if (suiteCursor.type === 'describe') {
        const cleanSuiteTitle = stripTagsFromTitle(suiteCursor.title);
        if (cleanSuiteTitle) describeTitles.push(cleanSuiteTitle);
      }
      suiteCursor = suiteCursor.parent;
    }
    describeTitles.reverse();

    if (describeTitles.length === 0) {
      const rawTitlePath =
        typeof test.titlePath === 'function' ? test.titlePath() : [];
      const fileSegmentIndex = findFileSegmentIndex(rawTitlePath);
      if (!filePath && fileSegmentIndex >= 0) {
        filePath = rawTitlePath[fileSegmentIndex];
      }
      const fallbackDescribePath =
        fileSegmentIndex >= 0
          ? rawTitlePath
              .slice(fileSegmentIndex + 1, -1)
              .map((title) => stripTagsFromTitle(title))
              .filter((title) => title.length > 0)
          : [];
      describeTitles.push(...fallbackDescribePath);
    }

    const describeTitle = describeTitles.at(-1);
    const hasDescribe = describeTitle !== undefined;
    const groupKey = hasDescribe
      ? `describe:${filePath ?? 'unknown'}:${describeTitles.join(' > ')}`
      : `test:${filePath ?? 'unknown'}:${slugifyTestTitle(sanitizedTitle)}`;

    return {
      describeTitle,
      filePath,
      folderName: slugifyFolderNameFromTitle(describeTitle ?? sanitizedTitle),
      groupKey,
    };
  }

  private allocateFolderName(baseName: string): string {
    const nextCount = (this.folderNameCounts.get(baseName) ?? 0) + 1;
    this.folderNameCounts.set(baseName, nextCount);
    if (nextCount === 1) return baseName;

    const suffix = `-${nextCount}`;
    const truncatedBase = baseName
      .slice(0, Math.max(1, MAX_FOLDER_NAME_LENGTH - suffix.length))
      .replace(/-+$/g, '');
    return `${truncatedBase}${suffix}`;
  }
}
