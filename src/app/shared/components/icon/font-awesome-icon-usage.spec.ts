import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.join(process.cwd(), 'src/app');
const forbiddenPatterns = ['<mat-' + 'icon', 'Mat' + 'IconModule'] as const;
const materialIconImport = '@angular/material/icon';
const allowedMaterialIconRegistryFile = path.join(
  sourceRoot,
  'app.component.ts',
);

const appSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return appSourceFiles(filePath);
    }

    if (
      entry.isFile() &&
      (entry.name.endsWith('.html') || entry.name.endsWith('.ts')) &&
      !entry.name.endsWith('.spec.ts')
    ) {
      return [filePath];
    }

    return [];
  });

describe('Font Awesome icon usage', () => {
  it('keeps Angular app icons on the Font Awesome component path', () => {
    const offenders = appSourceFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');
      return forbiddenPatterns
        .filter((pattern) => source.includes(pattern))
        .map(
          (pattern) => `${filePath.replace(sourceRoot, 'src/app')}: ${pattern}`,
        );
    });

    expect(offenders).toEqual([]);
  });

  it('keeps Material icon registry usage limited to the root bootstrap exception', () => {
    const offenders = appSourceFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');

      if (
        filePath === allowedMaterialIconRegistryFile ||
        !source.includes(materialIconImport)
      ) {
        return [];
      }

      return [
        `${filePath.replace(sourceRoot, 'src/app')}: ${materialIconImport}`,
      ];
    });

    expect(offenders).toEqual([]);
  });
});
