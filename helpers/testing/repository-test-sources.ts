import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const testSourcePattern = /\.(?:doc|setup|spec|test)\.(?:[cm]?[jt]sx?)$/u;
const runnerSupportSourcePattern = /\.(?:[cm]?[jt]sx?)$/u;
const excludedDirectoryNames = new Set([
  '.angular',
  '.git',
  'coverage',
  'dist',
  'node_modules',
  'playwright-report',
  'repos',
  'test-results',
]);

const collectRepositorySources = (
  relativeDirectory: string,
  sourcePattern: RegExp,
): string[] =>
  readdirSync(path.join(repositoryRoot, relativeDirectory), {
    withFileTypes: true,
  }).flatMap((entry) => {
    const sourcePath = path
      .join(relativeDirectory, entry.name)
      .replaceAll('\\', '/');

    if (entry.isDirectory()) {
      return excludedDirectoryNames.has(entry.name) ||
        entry.name.startsWith('.tmp-')
        ? []
        : collectRepositorySources(sourcePath, sourcePattern);
    }

    return entry.isFile() && sourcePattern.test(sourcePath) ? [sourcePath] : [];
  });

export const listRepositoryTestSources = () =>
  collectRepositorySources('', testSourcePattern).toSorted();

export const listRepositoryTestControlSources = () =>
  [
    ...new Set([
      ...listRepositoryTestSources(),
      ...collectRepositorySources('tests/support', runnerSupportSourcePattern),
    ]),
  ].toSorted();

export const isPlaywrightDefaultTestSource = (sourcePath: string) =>
  /\.(?:spec|test)\.(?:[cm]?[jt]sx?)$/u.test(sourcePath);
