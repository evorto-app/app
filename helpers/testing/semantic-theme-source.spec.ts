import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const readSource = (sourcePath: string): string =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

const productionAppSources = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const sourcePath = path.join(directory, entry);
    if (statSync(sourcePath).isDirectory()) {
      return productionAppSources(sourcePath);
    }
    if (!/\.(?:html|scss|ts)$/.test(entry) || entry.endsWith('.spec.ts')) {
      return [];
    }
    return [sourcePath];
  });

const semanticTokens = [
  'success',
  'on-success',
  'success-container',
  'on-success-container',
  'warning',
  'on-warning',
  'warning-container',
  'on-warning-container',
] as const;

describe('semantic state theme source', () => {
  it('bridges every success and warning role from the app theme into Tailwind', () => {
    const source = readSource('src/tailwind.css');
    const staticTheme = /@theme inline static\s*\{(?<tokens>[^}]*)\}/.exec(
      source,
    )?.groups?.['tokens'];

    expect(staticTheme).toBeDefined();
    for (const token of semanticTokens) {
      expect(staticTheme).toContain(`--color-${token}: var(--app-${token});`);
    }
    expect(source).not.toMatch(/--color-(?:on-)?warn(?:-container)?:/);
  });

  it('derives increased-contrast state pairs from each existing theme palette', () => {
    const mixin = readSource('src/_semantic-state-colors.scss');
    const styles = readSource('src/styles.scss');

    expect(mixin).toContain('@media (prefers-contrast: more)');
    expect(mixin).toContain('_opposite-container-tones($success-container)');
    expect(mixin).toContain('_opposite-container-tones($warning-container)');
    expect(
      styles.match(/@include semantic-state-colors\.theme\(/g),
    ).toHaveLength(2);
    expect(styles).not.toMatch(/--app-(?:on-)?warn(?:-container)?:/);
  });

  it('keeps production Tailwind consumers on the canonical warning vocabulary', () => {
    const deprecatedUtility =
      /\b(?:bg|border|fill|ring|stroke|text)-(?:on-)?warn(?:-container)?\b/;
    const violations = productionAppSources(
      path.join(repositoryRoot, 'src/app'),
    )
      .filter((sourcePath) =>
        deprecatedUtility.test(readFileSync(sourcePath, 'utf8')),
      )
      .map((sourcePath) => path.relative(repositoryRoot, sourcePath));

    expect(violations).toEqual([]);
  });
});
