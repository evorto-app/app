import * as fs from 'node:fs';
import path from 'node:path';

export const ensureDirectory = (
  directoryPath: string,
  options?: { empty?: boolean },
) => {
  if (options?.empty && fs.existsSync(directoryPath)) {
    fs.rmSync(directoryPath, { force: true, recursive: true });
  }
  fs.mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
};

export const writeFile = (filePath: string, content: Buffer | string) => {
  fs.writeFileSync(filePath, content);
  return filePath;
};

export const stripTagsFromTitle = (title: string): string =>
  title
    .replace(/(^|\s)@[a-z0-9_-]+(?:\([^)]*\))?(?=\s|$)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const slugifyTestTitle = (title: string): string =>
  (
    stripTagsFromTitle(title)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)+/g, '') || 'test'
  );

export const MAX_FOLDER_NAME_LENGTH = 64;

export const slugifyFolderNameFromTitle = (title: string): string =>
  (
    slugifyTestTitle(title)
      .slice(0, MAX_FOLDER_NAME_LENGTH)
      .replace(/-+$/g, '') || 'docs'
  );

export const titleFromTestFile = (filePath: string): string => {
  const baseName = path
    .basename(filePath)
    .replace(/\.(doc|spec|test)\.ts$/i, '')
    .trim();
  if (!baseName) return 'Documentation';
  return baseName
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(' ');
};

export const findFileSegmentIndex = (titlePath: string[]): number =>
  titlePath.findIndex(
    (segment) =>
      segment.includes('/') ||
      segment.includes('\\') ||
      /\.(doc|spec|test)\.ts$/i.test(segment),
  );

export const DOCUMENTATION_ATTACHMENT_NAMES = new Set([
  'image',
  'image-caption',
  'markdown',
  'permissions',
]);

export type TestSection = {
  content: string[];
  line: number;
  title: string;
};

export type TestGroupDocument = {
  describeTitle?: string;
  filePath?: string;
  folderName: string;
  sections: TestSection[];
};

export type TestGroupInfo = {
  describeTitle?: string;
  filePath?: string;
  folderName: string;
  groupKey: string;
};

