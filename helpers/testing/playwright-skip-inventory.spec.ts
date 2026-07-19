import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Source guard: browser/doc coverage must fail explicitly when a precondition
// is unavailable instead of disappearing behind `skip` or `fixme` calls.
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const testsRoot = path.join(repositoryRoot, 'tests');
const testInventoryPath = path.join(testsRoot, 'test-inventory.md');

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

const collectPlaywrightSpecAndDocFiles = () =>
  collectTypeScriptFiles(testsRoot)
    .map((entryPath) =>
      path.relative(testsRoot, entryPath).replaceAll('\\', '/'),
    )
    .filter(
      (entryPath) =>
        (entryPath.startsWith('docs/') || entryPath.startsWith('specs/')) &&
        (entryPath.endsWith('.doc.ts') ||
          entryPath.endsWith('.spec.ts') ||
          entryPath.endsWith('.test.ts')),
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
      (line) => line.match(/^ {2}- (?<path>(?:docs|specs)\/\S+)/)?.groups?.path,
    )
    .filter((path): path is string => path !== undefined);
};

const collectPlaywrightSkipEntries = () =>
  collectTypeScriptFiles(testsRoot).flatMap((sourcePath) => {
    const source = readFileSync(sourcePath, 'utf8');
    const lines = source.split('\n');
    const relativePath = path.relative(repositoryRoot, sourcePath);

    return lines.flatMap((line, index) =>
      [...line.matchAll(skipPattern)].map((match) =>
        `${relativePath}:${index + 1}:${match[0]}`.replaceAll('\\', '/'),
      ),
    );
  });

const collectPlaceholderMetadataEntries = () =>
  collectTypeScriptFiles(testsRoot).flatMap((sourcePath) => {
    const relativePath = path
      .relative(repositoryRoot, sourcePath)
      .replaceAll('\\', '/');

    if (allowedPlaceholderMetadataFiles.has(relativePath)) {
      return [];
    }

    const source = readFileSync(sourcePath, 'utf8');
    const lines = source.split('\n');

    return lines.flatMap((line, index) =>
      [...line.matchAll(placeholderMetadataPattern)].map(
        (match) => `${relativePath}:${index + 1}:${match[0]}`,
      ),
    );
  });

const collectFixedWaitEntries = () =>
  collectPlaywrightSpecAndDocFiles().flatMap((playwrightPath) => {
    const sourcePath = path.join(testsRoot, playwrightPath);
    const source = readFileSync(sourcePath, 'utf8');
    const lines = source.split('\n');
    const relativePath = path
      .relative(repositoryRoot, sourcePath)
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
      collectPlaywrightSpecAndDocFiles().toSorted(),
    );
  });

  it('keeps active Playwright coverage free of skip and fixme calls', () => {
    const entries = collectPlaywrightSkipEntries().toSorted();

    expect(entries).toEqual([]);
  });

  it('keeps real Playwright titles free of placeholder metadata', () => {
    expect(collectPlaceholderMetadataEntries()).toEqual([]);
  });

  it('keeps Playwright specs and docs free of fixed timeout waits', () => {
    expect(collectFixedWaitEntries()).toEqual([]);
  });
});
