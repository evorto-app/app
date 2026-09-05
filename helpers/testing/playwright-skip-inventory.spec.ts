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

interface ExecutableSourceContract {
  readonly categories: readonly string[];
  readonly files: number;
  readonly suite: 'docs' | 'specs';
}

const executableSourceContract = (): readonly ExecutableSourceContract[] => {
  const source = readFileSync(testInventoryPath, 'utf8');
  const contractSection = source.match(
    /## Executable Source Contract\n(?<section>[\s\S]*?)\n## Suite Ownership/u,
  )?.groups?.['section'];
  if (contractSection === undefined) {
    throw new Error(
      'tests/test-inventory.md is missing the Executable Source Contract',
    );
  }

  const contracts = [
    ...contractSection.matchAll(
      /^\| `(?<suite>docs|specs)`\s+\|\s+(?<files>\d+) \| (?<categories>[^|]+)\|$/gmu,
    ),
  ].map((match) => {
    const categories = match.groups?.['categories'];
    const fileCount = Number(match.groups?.['files']);
    const suite = match.groups?.['suite'];
    if (
      categories === undefined ||
      !Number.isSafeInteger(fileCount) ||
      (suite !== 'docs' && suite !== 'specs')
    ) {
      throw new Error('Invalid executable source contract row');
    }

    return {
      categories: categories
        .split(',')
        .map((category) => category.trim().replaceAll('`', '')),
      files: fileCount,
      suite,
    };
  });

  if (contracts.length !== 2) {
    throw new Error(
      'tests/test-inventory.md must define exactly one docs and one specs source contract',
    );
  }
  return contracts;
};

const currentExecutableSourceContract =
  (): readonly ExecutableSourceContract[] => {
    const sourceFiles = collectPlaywrightSpecAndDocFiles();
    return (['docs', 'specs'] as const).map((suite) => {
      const files = sourceFiles.filter((sourcePath) =>
        sourcePath.startsWith(`${suite}/`),
      );
      const categories = files.map((sourcePath) => {
        const category = sourcePath.split('/')[1];
        if (!category) {
          throw new Error(
            `Executable source has no top-level category: ${sourcePath}`,
          );
        }
        return category;
      });
      return {
        categories: [...new Set(categories)].toSorted(),
        files: files.length,
        suite,
      };
    });
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
  it('keeps documented executable source counts and categories aligned with disk discovery', () => {
    expect(executableSourceContract()).toEqual(
      currentExecutableSourceContract(),
    );
  });

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
