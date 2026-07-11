import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const collectPostgresSpecs = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectPostgresSpecs(entryPath);
    }
    if (entry.isFile() && entry.name.endsWith('.postgres.spec.ts')) {
      return [entryPath];
    }
    return [];
  });

const postgresSpecs = ['helpers', 'src'].flatMap((directory) =>
  collectPostgresSpecs(path.join(repositoryRoot, directory)),
);
const readSource = (sourcePath: string): string =>
  readFileSync(sourcePath, 'utf8');

describe('PostgreSQL integration source', () => {
  it('keeps every PostgreSQL spec in the dedicated serial project', () => {
    const unitConfig = readSource(
      path.join(repositoryRoot, 'vitest.config.ts'),
    );
    const postgresConfig = readSource(
      path.join(repositoryRoot, 'vitest.postgres.config.ts'),
    );

    expect(postgresSpecs).toHaveLength(10);
    expect(unitConfig).toContain("'**/*.postgres.spec.ts'");
    expect(postgresConfig).toContain("'helpers/**/*.postgres.spec.ts'");
    expect(postgresConfig).toContain("'src/**/*.postgres.spec.ts'");
    expect(postgresConfig).toContain('fileParallelism: false');
    expect(postgresConfig).toContain('maxWorkers: 1');
    expect(postgresConfig).toContain('passWithNoTests: false');
  });

  it('fails loudly instead of conditionally skipping database coverage', () => {
    for (const sourcePath of postgresSpecs) {
      const source = readSource(sourcePath);

      expect(source).toContain(
        "throw new Error('DATABASE_URL is required for PostgreSQL integration tests')",
      );
      expect(source).not.toMatch(/\bdescribe\.skip\b/u);
      expect(source.match(/if\s*\(\s*!databaseUrl\s*\)/gu)).toHaveLength(1);
      expect(source).not.toMatch(
        /if\s*\(\s*!databaseUrl\s*\)\s*\{?\s*return\b/u,
      );
    }
  });
});
