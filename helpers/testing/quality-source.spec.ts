import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (sourcePath: string): string =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

const listFiles = (directory: string, extension: string): string[] =>
  readdirSync(path.join(repositoryRoot, directory)).flatMap((entry) => {
    const sourcePath = `${directory}/${entry}`;
    const absolutePath = path.join(repositoryRoot, sourcePath);

    if (statSync(absolutePath).isDirectory()) {
      return listFiles(sourcePath, extension);
    }

    return sourcePath.endsWith(extension) ? [sourcePath] : [];
  });

describe('quality source', () => {
  it('keeps app templates on TanStack Query boolean status narrowing', () => {
    const sourceFiles = listFiles('src/app', '.html');

    for (const sourceFile of sourceFiles) {
      const source = readSource(sourceFile);

      expect(source, sourceFile).not.toMatch(
        /\b\w+Query\.status\(\)\s*===\s*['"](pending|success|error)['"]/u,
      );
    }
  });
});
