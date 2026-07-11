import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const sourceRoots = ['helpers', 'src', 'tests'].map((directory) =>
  path.join(repositoryRoot, directory),
);
const testFileSuffixes = ['.doc.ts', '.setup.ts', '.spec.ts', '.test.ts'];
const forbiddenControlPattern =
  /\b(?:test|it|describe|setup)(?:\s*\.\s*[\p{L}\p{N}_$]+)*\s*\.\s*(?:fail|fails|fixme|only|runIf|skip|skipIf|todo)\s*\(|\b(?:fdescribe|fit|pending|skip|xdescribe|xit)\s*\(/gu;
const forbiddenRetryConfigurationPattern =
  /\btest\s*\.\s*describe\s*\.\s*configure\s*\(\s*\{[^}]*\bretries\s*:\s*[1-9]\d*\b[^}]*\}\s*\)/gu;

const collectTestSources = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTestSources(entryPath);
    }
    if (
      entry.isFile() &&
      testFileSuffixes.some((suffix) => entry.name.endsWith(suffix))
    ) {
      return [entryPath];
    }
    return [];
  });

const collectForbiddenControls = (): string[] =>
  sourceRoots.flatMap((sourceRoot) =>
    collectTestSources(sourceRoot).flatMap((sourcePath) => {
      const source = readFileSync(sourcePath, 'utf8');
      const lines = source.split('\n');
      const relativePath = path
        .relative(repositoryRoot, sourcePath)
        .replaceAll('\\', '/');

      return lines.flatMap((line, index) =>
        [...line.matchAll(forbiddenControlPattern)].map(
          (match) => `${relativePath}:${index + 1}:${match[0]}`,
        ),
      );
    }),
  );

const collectForbiddenRetryConfigurations = (): string[] =>
  sourceRoots.flatMap((sourceRoot) =>
    collectTestSources(sourceRoot).flatMap((sourcePath) => {
      const source = readFileSync(sourcePath, 'utf8');
      const relativePath = path
        .relative(repositoryRoot, sourcePath)
        .replaceAll('\\', '/');

      return [...source.matchAll(forbiddenRetryConfigurationPattern)].map(
        (match) => {
          const line = source.slice(0, match.index).split('\n').length;
          return `${relativePath}:${line}:${match[0]}`;
        },
      );
    }),
  );

describe('test control source', () => {
  it.each([
    ['direct skip', ['test', 'skip'].join('.') + '()'],
    ['Effect skip', ['it', 'effect', 'skip'].join('.') + '()'],
    ['live conditional skip', ['it', 'live', 'skipIf'].join('.') + '()'],
    ['concurrent focus', ['it', 'concurrent', 'only'].join('.') + '()'],
    ['setup skip', ['setup', 'skip'].join('.') + '()'],
    ['dynamic context skip', ['skip'].join('') + '()'],
  ])('detects %s', (_name, source) => {
    expect([...source.matchAll(forbiddenControlPattern)]).toHaveLength(1);
  });

  it('detects test-local retry overrides', () => {
    const retryKey = ['re', 'tries'].join('');
    const source = `test.describe.configure({ mode: 'serial', ${retryKey}: 1 })`;

    expect([
      ...source.matchAll(forbiddenRetryConfigurationPattern),
    ]).toHaveLength(1);
  });

  it('keeps every collected test active and unfocused', () => {
    expect(collectForbiddenControls()).toEqual([]);
    expect(collectForbiddenRetryConfigurations()).toEqual([]);
  });

  it('keeps runtime completeness reporters on every repository-owned suite', () => {
    const vitestConfig = readFileSync(
      path.join(repositoryRoot, 'vitest.config.ts'),
      'utf8',
    );
    const postgresConfig = readFileSync(
      path.join(repositoryRoot, 'vitest.postgres.config.ts'),
      'utf8',
    );
    const playwrightConfig = readFileSync(
      path.join(repositoryRoot, 'playwright.config.ts'),
      'utf8',
    );
    const angularConfig = readFileSync(
      path.join(repositoryRoot, 'angular.json'),
      'utf8',
    );
    const angularVitestConfig = readFileSync(
      path.join(repositoryRoot, 'vitest.angular.config.ts'),
      'utf8',
    );
    const packageJson = readFileSync(
      path.join(repositoryRoot, 'package.json'),
      'utf8',
    );
    const e2eWorkflow = readFileSync(
      path.join(repositoryRoot, '.github/workflows/e2e-baseline.yml'),
      'utf8',
    );

    expect(vitestConfig).toContain('complete-vitest-run-reporter.ts');
    expect(postgresConfig).toContain('complete-vitest-run-reporter.ts');
    expect(angularConfig).toContain('complete-vitest-run-reporter.ts');
    expect(angularConfig).toContain('vitest.angular.config.ts');
    expect(angularVitestConfig).toMatch(/allowOnly:\s*false/u);
    expect(playwrightConfig).toContain('complete-playwright-run-reporter.ts');
    expect(packageJson).toContain(
      '--reporter=github,dot,./tests/support/reporters/complete-playwright-run-reporter.ts',
    );
    expect(e2eWorkflow).toContain(
      './tests/support/reporters/documentation-reporter.ts,./tests/support/reporters/complete-playwright-run-reporter.ts',
    );
  });
});
