import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const workspaceRoot = process.cwd();
const sourceRoot = path.join(workspaceRoot, 'src/app');
const tailwindThemePath = path.join(workspaceRoot, 'src/tailwind.css');
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
const materialColorTokenMappings = [
  ['background', 'background'],
  ['error', 'error'],
  ['error-container', 'error-container'],
  ['inverse-on-surface', 'inverse-on-surface'],
  ['inverse-primary', 'inverse-primary'],
  ['inverse-surface', 'inverse-surface'],
  ['on-background', 'on-background'],
  ['on-error', 'on-error'],
  ['on-error-container', 'on-error-container'],
  ['on-primary', 'on-primary'],
  ['on-primary-container', 'on-primary-container'],
  ['on-secondary', 'on-secondary'],
  ['on-secondary-container', 'on-secondary-container'],
  ['on-surface', 'on-surface'],
  ['on-surface-variant', 'on-surface-variant'],
  ['on-tertiary', 'on-tertiary'],
  ['on-tertiary-container', 'on-tertiary-container'],
  ['outline', 'outline'],
  ['outline-variant', 'outline-variant'],
  ['primary', 'primary'],
  ['primary-container', 'primary-container'],
  ['scrim', 'scrim'],
  ['secondary', 'secondary'],
  ['secondary-container', 'secondary-container'],
  ['surface', 'surface'],
  ['surface-bright', 'surface-bright'],
  ['surface-container', 'surface-container'],
  ['surface-container-high', 'surface-container-high'],
  ['surface-container-highest', 'surface-container-highest'],
  ['surface-container-low', 'surface-container-low'],
  ['surface-container-lowest', 'surface-container-lowest'],
  ['surface-dim', 'surface-dim'],
  ['surface-tint', 'surface-tint'],
  ['surface-variant', 'surface-variant'],
  ['tertiary', 'tertiary'],
  ['tertiary-container', 'tertiary-container'],
] as const;
const materialRadiusTokenMappings = [
  ['none', 'corner-none'],
  ['sm', 'corner-extra-small'],
  ['', 'corner-small'],
  ['md', 'corner-medium'],
  ['lg', 'corner-medium'],
  ['xl', 'corner-medium'],
  ['2xl', 'corner-large'],
  ['3xl', 'corner-extra-large'],
  ['full', 'corner-full'],
] as const;
const materialShadowTokenMappings = [
  ['0', 'level0'],
  ['1', 'level1'],
  ['2', 'level2'],
  ['3', 'level3'],
  ['4', 'level4'],
  ['5', 'level5'],
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
  it('keeps Tailwind semantic colors backed by Material system tokens', () => {
    const themeSource = readFileSync(tailwindThemePath, 'utf8');
    const missingMappings = materialColorTokenMappings.flatMap(
      ([tailwindToken, materialToken]) => {
        const declaration = `--color-${tailwindToken}: var(--mat-sys-${materialToken});`;

        return themeSource.includes(declaration) ? [] : [declaration];
      },
    );

    expect(themeSource).toContain('@theme inline');
    expect(missingMappings).toEqual([]);
  });

  it('keeps Tailwind radius and elevation backed by Material system tokens', () => {
    const themeSource = readFileSync(tailwindThemePath, 'utf8');
    const missingRadiusMappings = materialRadiusTokenMappings.flatMap(
      ([tailwindToken, materialToken]) => {
        const tokenSuffix = tailwindToken ? `-${tailwindToken}` : '';
        const declaration = `--radius${tokenSuffix}: var(--mat-sys-${materialToken});`;

        return themeSource.includes(declaration) ? [] : [declaration];
      },
    );
    const missingShadowMappings = materialShadowTokenMappings.flatMap(
      ([tailwindToken, materialToken]) => {
        const declaration = `--shadow-${tailwindToken}: var(--mat-sys-${materialToken});`;

        return themeSource.includes(declaration) ? [] : [declaration];
      },
    );

    expect([...missingRadiusMappings, ...missingShadowMappings]).toEqual([]);
  });

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
