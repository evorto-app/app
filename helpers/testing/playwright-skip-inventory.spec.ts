import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source guard: every skipped browser/doc test needs an explicit reason here so
// uncovered behavior does not disappear behind permanent `test.skip` calls.
const repositoryRoot = new URL('../..', import.meta.url).pathname;
const testsRoot = path.join(repositoryRoot, 'tests');
const testInventoryPath = path.join(testsRoot, 'test-inventory.md');

const allowedPlaywrightSkipEntries = [
  {
    entry: 'tests/docs/users/create-account.doc.ts:96:test.skip',
    reason:
      'Auth0 Management credentials are required for the integration doc.',
  },
  {
    entry: 'tests/specs/profile/create-account.spec.ts:23:test.skip',
    reason:
      'Auth0 Management credentials are required for create-account integration coverage.',
  },
  {
    entry: 'tests/specs/finance/stripe-webhook-replay.spec.ts:19:test.skip',
    reason: 'A Stripe webhook signing secret is required for replay coverage.',
  },
] as const;

const allowedEntries = new Set(
  allowedPlaywrightSkipEntries.map((entry) => entry.entry),
);

const skipPattern = /\b(?:test|it|describe)\.(skip|fixme)\b/g;
const placeholderMetadataPattern = /@(track|req|doc)\(/g;
const fixedWaitPattern = /\.waitForTimeout\s*\(/g;

const allowedPlaceholderMetadataFiles = new Set([
  'tests/specs/reporting/reporter-paths.test.ts',
]);

const collectTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectTypeScriptFiles(entryPath);
    }

    return entry.isFile() && entryPath.endsWith('.ts') ? [entryPath] : [];
  });

const collectPlaywrightSpecAndDocumentFiles = () =>
  collectTypeScriptFiles(testsRoot)
    .map((filePath) => path.relative(testsRoot, filePath).replaceAll('\\', '/'))
    .filter(
      (path) =>
        (path.startsWith('docs/') || path.startsWith('specs/')) &&
        (path.endsWith('.doc.ts') ||
          path.endsWith('.spec.ts') ||
          path.endsWith('.test.ts')),
    );

const collectActiveInventoryFiles = () => {
  const source = readFileSync(testInventoryPath, 'utf8');
  const activeFilesSection = source.match(
    /## Active Files\n(?<section>[\s\S]*?)\n## Suite Ownership/,
  )?.groups?.section;

  if (activeFilesSection === undefined) {
    throw new Error('tests/test-inventory.md is missing the Active Files list');
  }

  return activeFilesSection
    .split('\n')
    .map(
      (line) =>
        line.match(/^\s{2}- (?<path>(?:docs|specs)\/\S+)/)?.groups?.path,
    )
    .filter((path): path is string => path !== undefined);
};

const collectPlaywrightSkipEntries = () =>
  collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const lines = source.split('\n');
    const relativePath = path.relative(repositoryRoot, filePath);

    return lines.flatMap((line, index) =>
      [...line.matchAll(skipPattern)].map((match) =>
        `${relativePath}:${index + 1}:${match[0]}`.replaceAll('\\', '/'),
      ),
    );
  });

const collectPlaceholderMetadataEntries = () =>
  collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const relativePath = path
      .relative(repositoryRoot, filePath)
      .replaceAll('\\', '/');

    if (allowedPlaceholderMetadataFiles.has(relativePath)) {
      return [];
    }

    const source = readFileSync(filePath, 'utf8');
    const lines = source.split('\n');

    return lines.flatMap((line, index) =>
      [...line.matchAll(placeholderMetadataPattern)].map(
        (match) => `${relativePath}:${index + 1}:${match[0]}`,
      ),
    );
  });

const collectFixedWaitEntries = () =>
  collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const lines = source.split('\n');
    const relativePath = path
      .relative(repositoryRoot, filePath)
      .replaceAll('\\', '/');

    return lines.flatMap((line, index) =>
      [...line.matchAll(fixedWaitPattern)].map(
        (match) => `${relativePath}:${index + 1}:${match[0]}`,
      ),
    );
  });

describe('Playwright skip inventory', () => {
  it('keeps the active test inventory aligned with Playwright docs and specs on disk', () => {
    expect(collectActiveInventoryFiles().toSorted()).toEqual(
      collectPlaywrightSpecAndDocumentFiles().toSorted(),
    );
  });

  it('keeps every skip and fixme explicitly classified', () => {
    const entries = collectPlaywrightSkipEntries().toSorted();

    expect(entries).toEqual([...allowedEntries].toSorted());
  });

  it('keeps every allowed skip and fixme tied to a reason', () => {
    expect(
      allowedPlaywrightSkipEntries.map((entry) => entry.reason.trim()),
    ).toEqual([
      'Auth0 Management credentials are required for the integration doc.',
      'Auth0 Management credentials are required for create-account integration coverage.',
      'A Stripe webhook signing secret is required for replay coverage.',
    ]);
  });

  it('keeps real Playwright titles free of placeholder metadata', () => {
    expect(collectPlaceholderMetadataEntries()).toEqual([]);
  });

  it('keeps Playwright specs and docs free of fixed timeout waits', () => {
    expect(collectFixedWaitEntries()).toEqual([]);
  });
});
