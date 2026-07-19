import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  isPlaywrightDefaultTestSource,
  listRepositoryTestSources,
  repositoryRoot,
} from './repository-test-sources';
type CanonicalSuite =
  'angular-unit' | 'playwright' | 'postgres-integration' | 'server-unit';

const normalizePath = (sourcePath: string) => sourcePath.replaceAll('\\', '/');

const ownersForTestPath = (sourcePath: string): CanonicalSuite[] => {
  const normalizedPath = normalizePath(sourcePath);
  const owners: CanonicalSuite[] = [];
  const postgresSpec = normalizedPath.endsWith('.postgres.spec.ts');

  if (
    postgresSpec &&
    (normalizedPath.startsWith('helpers/') || normalizedPath.startsWith('src/'))
  ) {
    owners.push('postgres-integration');
  }

  if (
    !postgresSpec &&
    normalizedPath.endsWith('.spec.ts') &&
    (normalizedPath.startsWith('helpers/') ||
      normalizedPath.startsWith('src/db/') ||
      normalizedPath.startsWith('src/server/'))
  ) {
    owners.push('server-unit');
  }

  if (
    normalizedPath.endsWith('.spec.ts') &&
    (normalizedPath.startsWith('src/app/') ||
      normalizedPath.startsWith('src/shared/'))
  ) {
    owners.push('angular-unit');
  }

  if (
    /^tests\/docs\/.+\.doc\.ts$/u.test(normalizedPath) ||
    (normalizedPath.startsWith('tests/') &&
      isPlaywrightDefaultTestSource(normalizedPath)) ||
    normalizedPath === 'tests/setup/authentication.setup.ts' ||
    normalizedPath === 'tests/setup/database.setup.ts'
  ) {
    owners.push('playwright');
  }

  return owners;
};

const ownershipViolation = (
  sourcePath: string,
  owners: readonly CanonicalSuite[],
) =>
  `${sourcePath}: expected exactly one canonical suite owner, found ${owners.length} (${owners.join(', ') || 'none'})`;

const readSource = (sourcePath: string) =>
  readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');

const configStringArrays = (source: string, propertyName: string) => {
  const sourceFile = ts.createSourceFile(
    'config.ts',
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const arrays: string[][] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === propertyName) ||
        (ts.isStringLiteralLike(node.name) &&
          node.name.text === propertyName)) &&
      ts.isArrayLiteralExpression(node.initializer)
    ) {
      const values = node.initializer.elements.flatMap((element) =>
        ts.isStringLiteralLike(element) ? [element.text] : [],
      );
      if (values.length === node.initializer.elements.length) {
        arrays.push(values);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return arrays;
};

const externalTags = new Set([
  '@needs-auth0-management',
  '@needs-google-maps',
  '@needs-live-esncard',
]);
const externalTagPattern = /@needs-[a-z0-9-]+/gu;
const liveProviderSources = new Set([
  'tests/docs/profile/discounts.doc.ts',
  'tests/specs/profile/user-profile-live-esncard.spec.ts',
]);

const scriptKindForPath = (sourcePath: string) => {
  if (/\.tsx$/u.test(sourcePath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/u.test(sourcePath)) return ts.ScriptKind.JSX;
  if (/\.(?:c|m)?js$/u.test(sourcePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

const externalTagRoutingViolations = (sourcePath: string, source: string) => {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(sourcePath),
  );
  const violations: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) {
      const tags = [
        ...new Set(
          [...node.text.matchAll(externalTagPattern)].map((match) => match[0]),
        ),
      ];
      const location = sourceFile.getLineAndCharacterOfPosition(
        node.getStart(sourceFile),
      );
      for (const tag of tags) {
        if (!externalTags.has(tag)) {
          violations.push(
            `${sourcePath}:${location.line + 1}: unknown external test tag ${tag}`,
          );
        }
        if (
          tag === '@needs-live-esncard' &&
          !liveProviderSources.has(sourcePath)
        ) {
          violations.push(
            `${sourcePath}:${location.line + 1}: live ESNcard coverage is not collected by a dedicated live-provider project`,
          );
        }
      }
      if (tags.length > 1) {
        violations.push(
          `${sourcePath}:${location.line + 1}: one test title cannot route to multiple external projects (${tags.join(', ')})`,
        );
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
};

describe('test suite ownership source', () => {
  it.each([
    ['helpers/testing/example.spec.ts', 'server-unit'],
    ['src/db/schema/example.spec.ts', 'server-unit'],
    ['src/server/example.spec.ts', 'server-unit'],
    ['src/app/example.spec.ts', 'angular-unit'],
    ['src/shared/example.spec.ts', 'angular-unit'],
    ['src/server/example.postgres.spec.ts', 'postgres-integration'],
    ['tests/docs/example.doc.ts', 'playwright'],
    ['tests/setup/authentication.setup.ts', 'playwright'],
    ['tests/setup/database.setup.ts', 'playwright'],
    ['tests/root-level.spec.ts', 'playwright'],
    ['tests/support/nested.test.ts', 'playwright'],
    ['tests/support/component.spec.tsx', 'playwright'],
    ['tests/support/module.spec.mts', 'playwright'],
    ['tests/support/legacy.test.js', 'playwright'],
    ['tests/specs/example.spec.ts', 'playwright'],
    ['tests/specs/example.test.ts', 'playwright'],
  ])('assigns %s to %s', (sourcePath, expectedOwner) => {
    expect(ownersForTestPath(sourcePath)).toEqual([expectedOwner]);
  });

  it('leaves unsupported test locations unowned with an actionable diagnostic', () => {
    const sourcePath = 'src/types/unowned.spec.ts';
    const owners = ownersForTestPath(sourcePath);

    expect(owners).toEqual([]);
    expect(ownershipViolation(sourcePath, owners)).toBe(
      'src/types/unowned.spec.ts: expected exactly one canonical suite owner, found 0 (none)',
    );
  });

  it('finds test-like sources outside the current runner roots', () => {
    const sourcePath = 'scripts/unowned.test.ts';
    const owners = ownersForTestPath(sourcePath);

    expect(owners).toEqual([]);
    expect(ownershipViolation(sourcePath, owners)).toContain(
      'expected exactly one canonical suite owner',
    );
  });

  it('does not mistake an unmatched Playwright setup suffix for an owned test', () => {
    const sourcePath = 'tests/setup/forgotten.setup.ts';
    const owners = ownersForTestPath(sourcePath);

    expect(owners).toEqual([]);
    expect(ownershipViolation(sourcePath, owners)).toBe(
      'tests/setup/forgotten.setup.ts: expected exactly one canonical suite owner, found 0 (none)',
    );
  });

  it('keeps the ownership model tied to the canonical runner configurations', () => {
    const serverConfig = readSource('vitest.config.ts');
    const angularWorkspace = readSource('angular.json');
    const postgresConfig = readSource('vitest.postgres.config.ts');
    const playwrightConfig = readSource('playwright.config.ts');

    expect(configStringArrays(serverConfig, 'include')).toEqual([
      [
        'helpers/**/*.spec.ts',
        'src/db/**/*.spec.ts',
        'src/server/**/*.spec.ts',
      ],
    ]);
    expect(configStringArrays(serverConfig, 'exclude')).toEqual([
      [
        '**/node_modules/**',
        '**/dist/**',
        '**/*.postgres.spec.ts',
        'src/app/**/*.spec.ts',
        'tests/**',
      ],
    ]);
    expect(angularWorkspace).toContain(
      '"include": ["src/app/**/*.spec.ts", "src/shared/**/*.spec.ts"]',
    );
    expect(configStringArrays(postgresConfig, 'include')).toEqual([
      ['helpers/**/*.postgres.spec.ts', 'src/**/*.postgres.spec.ts'],
    ]);
    expect(playwrightConfig).toContain("testDir: './tests'");
    expect(playwrightConfig).toContain(
      String.raw`testMatch: /database\.setup\.ts$/`,
    );
    expect(playwrightConfig).toContain(
      String.raw`testMatch: /authentication\.setup\.ts$/`,
    );
    expect(playwrightConfig).toContain(
      String.raw`testMatch: /docs\/.*\.doc\.ts$/`,
    );
    expect(playwrightConfig).toContain(
      String.raw`testIgnore: /docs\/.*\.doc\.ts$/`,
    );
  });

  it('fails closed for unknown, duplicated, or misplaced external tags', () => {
    expect(
      externalTagRoutingViolations(
        'tests/specs/example.spec.ts',
        `test('provider @needs-live-esncard', body)`,
      ),
    ).toHaveLength(1);
    expect(
      externalTagRoutingViolations(
        'tests/specs/profile/user-profile-live-esncard.spec.ts',
        `test('provider @needs-live-esncard @needs-google-maps', body)`,
      ),
    ).toHaveLength(1);
    expect(
      externalTagRoutingViolations(
        'tests/specs/example.spec.ts',
        `test('provider @needs-unknown', body)`,
      ),
    ).toHaveLength(1);
  });

  it('routes every external-tagged test to one canonical project', () => {
    const violations = listRepositoryTestSources()
      .filter((sourcePath) => sourcePath.startsWith('tests/'))
      .flatMap((sourcePath) =>
        externalTagRoutingViolations(sourcePath, readSource(sourcePath)),
      );

    expect(
      violations,
      `External test tag routing violations:\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('assigns every repository test source to exactly one canonical suite', () => {
    const violations = listRepositoryTestSources().flatMap((sourcePath) => {
      const owners = ownersForTestPath(sourcePath);
      return owners.length === 1
        ? []
        : [ownershipViolation(sourcePath, owners)];
    });

    expect(
      violations,
      `Every test source must have exactly one canonical suite owner:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});
