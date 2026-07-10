import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (relativePath: string): string =>
  readFileSync(path.join(repositoryRoot, relativePath), 'utf8');

describe('CI quality source', () => {
  it('runs every deterministic generated-docs flow in baseline CI', () => {
    const source = readSource('.github/workflows/e2e-baseline.yml');

    expect(source).toContain('bunx playwright test --project=docs-baseline');
    expect(source).not.toMatch(/--grep-invert\s+["']?@finance/u);
  });

  it('keeps repository-owned pull request quality gates complete', () => {
    const source = readSource('.github/workflows/pr-quality.yml');

    expect(source).toContain('pull_request:');
    expect(source).toContain('name: Knope and change files');
    expect(source).toContain('run: knope --validate');
    expect(source).toContain('name: Lint, unit tests, and build');
    expect(source).toContain('bun run lint');
    expect(source).toContain('git diff --exit-code');
    expect(source).toContain('bun run test:unit:server');
    expect(source).toMatch(/run: bun run test:unit\n/u);
    expect(source).toContain('bun run build:app');
  });
});
