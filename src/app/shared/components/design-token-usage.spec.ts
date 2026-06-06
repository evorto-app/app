import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.join(process.cwd(), 'src/app');
const sourceExtensions = ['.css', '.html', '.scss', '.ts'] as const;
const literalColorPatterns = [
  {
    label: 'hex color literal',
    pattern: /#[0-9a-fA-F]{3,8}\b/u,
  },
  {
    label: 'rgb color literal',
    pattern: /\brgba?\(/u,
  },
  {
    label: 'hsl color literal',
    pattern: /\bhsla?\(/u,
  },
  {
    label: 'arbitrary color utility',
    pattern:
      /\b(?:bg|text|border|ring|outline|decoration|from|via|to)-\[(?:#|rgba?\(|hsla?\()[^\]]+\]/u,
  },
] as const;
const typographyPatterns = [
  {
    label: 'letter spacing utility',
    pattern: /\b-?tracking-(?:\[[^\]]+\]|[a-z0-9-]+)/u,
  },
  {
    label: 'letter-spacing declaration',
    pattern: /\bletter-spacing\s*:/u,
  },
  {
    label: 'viewport-scaled text utility',
    pattern: /\btext-\[[^\]]*(?:vw|vh|clamp\()[^\]]*\]/u,
  },
  {
    label: 'viewport-scaled font-size declaration',
    pattern: /\bfont-size\s*:[^;]*(?:vw|vh|clamp\()/u,
  },
] as const;
const textWrappingPatterns = [
  {
    label: 'nowrap utility',
    pattern: /\b(?:whitespace-nowrap|text-nowrap)\b/u,
  },
  {
    label: 'truncate utility',
    pattern: /\btruncate\b/u,
  },
  {
    label: 'line-clamp utility',
    pattern: /\bline-clamp-[a-z0-9-]+/u,
  },
] as const;
const viewportWidthPatterns = [
  {
    label: 'full viewport width utility',
    pattern:
      /(?:^|[\s"'`{])(?:w-screen|min-w-screen|max-w-screen)(?=$|[\s"'`}])/u,
  },
  {
    label: 'arbitrary viewport width utility',
    pattern: /\b(?:w|min-w|max-w)-\[[^\]]*(?:vw|dvw|svw|lvw)[^\]]*\]/u,
  },
  {
    label: 'viewport width declaration',
    pattern: /\b(?:width|min-width|max-width)\s*:[^;]*(?:vw|dvw|svw|lvw)/u,
  },
] as const;
const debugPatterns = [
  {
    label: 'direct console usage',
    pattern: /\bconsole\.(?:debug|error|info|log|warn)\s*\(/u,
  },
  {
    label: 'debugger statement',
    pattern: /\bdebugger\b/u,
  },
] as const;
const materialCardPatterns = [
  {
    label: 'Angular Material card element',
    pattern: /<mat-card\b/u,
  },
  {
    label: 'Angular Material card module import',
    pattern: /\bMatCardModule\b/u,
  },
  {
    label: 'Angular Material card package import',
    pattern: /@angular\/material\/card/u,
  },
] as const;
const decorativeBackgroundPatterns = [
  {
    label: 'gradient background utility',
    pattern: /\bbg-gradient-(?:to|radial|conic)[a-z0-9-]*/u,
  },
  {
    label: 'CSS gradient declaration',
    pattern: /\b(?:linear|radial|conic)-gradient\(/u,
  },
  {
    label: 'decorative blur utility',
    pattern: /\bblur-(?:2xl|3xl|\[[^\]]+\])/u,
  },
  {
    label: 'decorative orb copy',
    pattern: /\b(?:orb|bokeh)\b/u,
  },
] as const;
const adHocElevationPatterns = [
  {
    label: 'shadow utility',
    pattern: /\bshadow(?:-(?:2xl|inner|lg|md|sm|xl|\[[^\]]+\]))?\b/u,
  },
  {
    label: 'drop-shadow utility',
    pattern: /\bdrop-shadow(?:-(?:2xl|lg|md|sm|xl|\[[^\]]+\]))?\b/u,
  },
  {
    label: 'box-shadow declaration',
    pattern: /\bbox-shadow\s*:/u,
  },
  {
    label: 'Angular Material elevation class',
    pattern: /\bmat-elevation-z\d+\b/u,
  },
] as const;

const appSourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return appSourceFiles(filePath);
    }

    if (
      entry.isFile() &&
      sourceExtensions.some((extension) => entry.name.endsWith(extension)) &&
      !entry.name.endsWith('.spec.ts')
    ) {
      return [filePath];
    }

    return [];
  });

describe('design token usage', () => {
  it('keeps app UI colors on Material and Tailwind tokens', () => {
    const offenders = appSourceFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');

      return literalColorPatterns.flatMap(({ label, pattern }) => {
        const matches = source.match(pattern);

        return matches
          ? [
              `${filePath.replace(sourceRoot, 'src/app')}: ${label} (${matches[0]})`,
            ]
          : [];
      });
    });

    expect(offenders).toEqual([]);
  });

  it('keeps app typography stable across viewports', () => {
    const offenders = appSourceFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');

      return typographyPatterns.flatMap(({ label, pattern }) => {
        const matches = source.match(pattern);

        return matches
          ? [
              `${filePath.replace(sourceRoot, 'src/app')}: ${label} (${matches[0]})`,
            ]
          : [];
      });
    });

    expect(offenders).toEqual([]);
  });

  it('keeps app text wrapping instead of clipping on narrow viewports', () => {
    const offenders = appSourceFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');

      return textWrappingPatterns.flatMap(({ label, pattern }) => {
        const matches = source.match(pattern);

        return matches
          ? [
              `${filePath.replace(sourceRoot, 'src/app')}: ${label} (${matches[0]})`,
            ]
          : [];
      });
    });

    expect(offenders).toEqual([]);
  });

  it('keeps app layouts from forcing viewport-width containers', () => {
    const offenders = appSourceFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');

      return viewportWidthPatterns.flatMap(({ label, pattern }) => {
        const matches = source.match(pattern);

        return matches
          ? [
              `${filePath.replace(sourceRoot, 'src/app')}: ${label} (${matches[0]})`,
            ]
          : [];
      });
    });

    expect(offenders).toEqual([]);
  });

  it('keeps app diagnostics on scoped browser loggers', () => {
    const offenders = appSourceFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');

      return debugPatterns.flatMap(({ label, pattern }) => {
        const matches = source.match(pattern);

        return matches
          ? [
              `${filePath.replace(sourceRoot, 'src/app')}: ${label} (${matches[0]})`,
            ]
          : [];
      });
    });

    expect(offenders).toEqual([]);
  });

  it('keeps app card surfaces on semantic Material containers', () => {
    const offenders = appSourceFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');

      return materialCardPatterns.flatMap(({ label, pattern }) => {
        const matches = source.match(pattern);

        return matches
          ? [
              `${filePath.replace(sourceRoot, 'src/app')}: ${label} (${matches[0]})`,
            ]
          : [];
      });
    });

    expect(offenders).toEqual([]);
  });

  it('keeps app backgrounds on Material surfaces instead of decorative gradients', () => {
    const offenders = appSourceFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');

      return decorativeBackgroundPatterns.flatMap(({ label, pattern }) => {
        const matches = source.match(pattern);

        return matches
          ? [
              `${filePath.replace(sourceRoot, 'src/app')}: ${label} (${matches[0]})`,
            ]
          : [];
      });
    });

    expect(offenders).toEqual([]);
  });

  it('keeps app surfaces from adding ad hoc shadows or elevation', () => {
    const offenders = appSourceFiles(sourceRoot).flatMap((filePath) => {
      const source = readFileSync(filePath, 'utf8');

      return adHocElevationPatterns.flatMap(({ label, pattern }) => {
        const matches = source.match(pattern);

        return matches
          ? [
              `${filePath.replace(sourceRoot, 'src/app')}: ${label} (${matches[0]})`,
            ]
          : [];
      });
    });

    expect(offenders).toEqual([]);
  });
});
