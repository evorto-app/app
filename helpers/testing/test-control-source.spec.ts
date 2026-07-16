import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  listRepositoryTestControlSources,
  listRepositoryTestSources,
  repositoryRoot,
} from './repository-test-sources';

const testApiRootNames = new Set([
  'describe',
  'it',
  'setup',
  'test',
  'testInfo',
]);
const forbiddenControlNames = new Set([
  'fail',
  'fails',
  'fixme',
  'only',
  'runIf',
  'skip',
  'skipIf',
  'todo',
]);
const forbiddenDirectControlNames = new Set([
  'fdescribe',
  'fit',
  'pending',
  'skip',
  'xdescribe',
  'xit',
]);
const rootFactoryNames = new Set(['extend', 'mergeTests']);
const forbiddenOptionPropertyNames = new Set(['fails', 'only', 'skip', 'todo']);
const retryPropertyNames = new Set(['retries', 'retry']);

type ApiChain = Readonly<{
  base: string;
  members: readonly (string | undefined)[];
}>;

type ApiResolution =
  Readonly<{ kind: 'control'; name: string }> | Readonly<{ kind: 'root' }>;

type TestControlViolation = Readonly<{
  column: number;
  control: string;
  line: number;
  sourcePath: string;
}>;

const scriptKindForPath = (sourcePath: string) => {
  if (/\.tsx$/u.test(sourcePath)) return ts.ScriptKind.TSX;
  if (/\.jsx$/u.test(sourcePath)) return ts.ScriptKind.JSX;
  if (/\.(?:c|m)?js$/u.test(sourcePath)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
};

const unwrapExpression = (expression: ts.Expression): ts.Expression => {
  let current = expression;

  while (
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
};

const staticExpressionName = (
  expression: ts.Expression | undefined,
): string | undefined => {
  if (expression === undefined) {
    return undefined;
  }

  const unwrapped = unwrapExpression(expression);
  return ts.isStringLiteralLike(unwrapped) ? unwrapped.text : undefined;
};

const staticPropertyName = (
  propertyName: ts.PropertyName | undefined,
): string | undefined => {
  if (propertyName === undefined) {
    return undefined;
  }
  if (
    ts.isIdentifier(propertyName) ||
    ts.isNumericLiteral(propertyName) ||
    ts.isStringLiteralLike(propertyName)
  ) {
    return propertyName.text;
  }
  if (ts.isComputedPropertyName(propertyName)) {
    return staticExpressionName(propertyName.expression);
  }
  return undefined;
};

const expressionChain = (expression: ts.Expression): ApiChain | undefined => {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return { base: unwrapped.text, members: [] };
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    const parent = expressionChain(unwrapped.expression);
    return parent === undefined
      ? undefined
      : { ...parent, members: [...parent.members, unwrapped.name.text] };
  }
  if (ts.isElementAccessExpression(unwrapped)) {
    const parent = expressionChain(unwrapped.expression);
    return parent === undefined
      ? undefined
      : {
          ...parent,
          members: [
            ...parent.members,
            staticExpressionName(unwrapped.argumentExpression),
          ],
        };
  }
  return undefined;
};

const resolveApiChain = (
  chain: ApiChain,
  rootAliases: ReadonlySet<string>,
  controlAliases: ReadonlyMap<string, string>,
): ApiResolution | undefined => {
  const aliasedControl = controlAliases.get(chain.base);
  if (aliasedControl !== undefined) {
    return { kind: 'control', name: aliasedControl };
  }
  if (!rootAliases.has(chain.base)) {
    return undefined;
  }

  for (const member of chain.members) {
    if (member === undefined) {
      return { kind: 'control', name: 'dynamic test API member' };
    }
    if (forbiddenControlNames.has(member)) {
      return { kind: 'control', name: member };
    }
  }

  return { kind: 'root' };
};

const registerResolvedAlias = (
  alias: string,
  chain: ApiChain,
  rootAliases: Set<string>,
  controlAliases: Map<string, string>,
) => {
  const resolution = resolveApiChain(chain, rootAliases, controlAliases);
  if (resolution?.kind === 'root') {
    const previousSize = rootAliases.size;
    rootAliases.add(alias);
    return rootAliases.size !== previousSize;
  }
  if (resolution?.kind === 'control') {
    if (controlAliases.has(alias)) {
      return false;
    }
    controlAliases.set(alias, resolution.name);
    return true;
  }
  return false;
};

const registerBindingAliases = (
  declaration: ts.VariableDeclaration,
  rootAliases: Set<string>,
  controlAliases: Map<string, string>,
) => {
  if (declaration.initializer === undefined) {
    return false;
  }
  if (ts.isIdentifier(declaration.name)) {
    const initializerChain = expressionChain(declaration.initializer);
    if (initializerChain !== undefined) {
      return registerResolvedAlias(
        declaration.name.text,
        initializerChain,
        rootAliases,
        controlAliases,
      );
    }
    const initializer = unwrapExpression(declaration.initializer);
    if (!ts.isCallExpression(initializer)) {
      return false;
    }
    const factoryChain = expressionChain(initializer.expression);
    const factoryResolution =
      factoryChain === undefined
        ? undefined
        : resolveApiChain(factoryChain, rootAliases, controlAliases);
    if (
      factoryResolution?.kind !== 'root' ||
      !rootFactoryNames.has(factoryChain?.members.at(-1) ?? '')
    ) {
      return false;
    }
    const previousSize = rootAliases.size;
    rootAliases.add(declaration.name.text);
    return rootAliases.size !== previousSize;
  }

  const initializerChain = expressionChain(declaration.initializer);
  if (initializerChain === undefined) {
    return false;
  }
  if (!ts.isObjectBindingPattern(declaration.name)) {
    return false;
  }

  let changed = false;
  for (const element of declaration.name.elements) {
    if (!ts.isIdentifier(element.name)) {
      continue;
    }
    const propertyName =
      element.propertyName === undefined
        ? element.name.text
        : staticPropertyName(element.propertyName);
    changed =
      registerResolvedAlias(
        element.name.text,
        {
          ...initializerChain,
          members: [...initializerChain.members, propertyName],
        },
        rootAliases,
        controlAliases,
      ) || changed;
  }
  return changed;
};

const collectApiAliases = (
  sourceFile: ts.SourceFile,
  assumeTestGlobals: boolean,
) => {
  const rootAliases = new Set(
    assumeTestGlobals ? testApiRootNames : ['testInfo'],
  );
  const controlAliases = new Map(
    assumeTestGlobals
      ? [...forbiddenDirectControlNames].map((name) => [name, name])
      : [],
  );

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      statement.importClause?.namedBindings === undefined
    ) {
      continue;
    }
    const namedBindings = statement.importClause.namedBindings;
    if (ts.isNamespaceImport(namedBindings)) {
      const moduleName = ts.isStringLiteral(statement.moduleSpecifier)
        ? statement.moduleSpecifier.text
        : '';
      if (
        moduleName === 'vitest' ||
        moduleName === '@effect/vitest' ||
        moduleName === '@playwright/test' ||
        moduleName.includes('/support/fixtures/')
      ) {
        rootAliases.add(namedBindings.name.text);
      }
      continue;
    }
    for (const element of namedBindings.elements) {
      const importedName = (element.propertyName ?? element.name).text;
      if (testApiRootNames.has(importedName)) {
        rootAliases.add(element.name.text);
      }
      if (
        forbiddenControlNames.has(importedName) ||
        forbiddenDirectControlNames.has(importedName)
      ) {
        controlAliases.set(element.name.text, importedName);
      }
    }
  }

  let changed = true;
  while (changed) {
    changed = false;
    const visit = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node)) {
        changed =
          registerBindingAliases(node, rootAliases, controlAliases) || changed;
      } else if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isIdentifier(node.left)
      ) {
        const chain = expressionChain(node.right);
        if (chain !== undefined) {
          changed =
            registerResolvedAlias(
              node.left.text,
              chain,
              rootAliases,
              controlAliases,
            ) || changed;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }

  return { controlAliases, rootAliases };
};

const detectForbiddenTestControls = (
  source: string,
  sourcePath: string,
  assumeTestGlobals = true,
): TestControlViolation[] => {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(sourcePath),
  );
  const { controlAliases, rootAliases } = collectApiAliases(
    sourceFile,
    assumeTestGlobals,
  );
  const violations: TestControlViolation[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const chain = expressionChain(node.expression);
      const resolution =
        chain === undefined
          ? undefined
          : resolveApiChain(chain, rootAliases, controlAliases);
      if (resolution?.kind === 'control') {
        const location = sourceFile.getLineAndCharacterOfPosition(
          node.expression.getStart(sourceFile),
        );
        violations.push({
          column: location.character + 1,
          control: resolution.name,
          line: location.line + 1,
          sourcePath,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return violations;
};

const formatControlViolation = (violation: TestControlViolation) =>
  `${violation.sourcePath}:${violation.line}:${violation.column}: forbidden test control ${violation.control}`;

const testApiCallChain = (expression: ts.Expression): ApiChain | undefined => {
  const unwrapped = unwrapExpression(expression);
  return ts.isCallExpression(unwrapped)
    ? testApiCallChain(unwrapped.expression)
    : expressionChain(unwrapped);
};

const isStaticZero = (expression: ts.Expression) => {
  const unwrapped = unwrapExpression(expression);
  return ts.isNumericLiteral(unwrapped) && Number(unwrapped.text) === 0;
};

const detectForbiddenTestConfigurations = (
  source: string,
  sourcePath: string,
  assumeTestGlobals = true,
): TestControlViolation[] => {
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(sourcePath),
  );
  const { controlAliases, rootAliases } = collectApiAliases(
    sourceFile,
    assumeTestGlobals,
  );
  const violations: TestControlViolation[] = [];
  const recordedViolations = new Set<string>();
  const optionAliases = new Map<string, ts.Expression>();
  const configureAliases = new Set<string>();

  const collectOptionAliases = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
      optionAliases.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectOptionAliases);
  };
  collectOptionAliases(sourceFile);

  const isStaticOptionsObject = (
    expression: ts.Expression,
    visitedAliases: ReadonlySet<string> = new Set(),
  ): boolean => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isObjectLiteralExpression(unwrapped)) return true;
    if (!ts.isIdentifier(unwrapped) || visitedAliases.has(unwrapped.text)) {
      return false;
    }
    const initializer = optionAliases.get(unwrapped.text);
    return initializer === undefined
      ? false
      : isStaticOptionsObject(
          initializer,
          new Set([...visitedAliases, unwrapped.text]),
        );
  };

  let configureAliasesChanged = true;
  while (configureAliasesChanged) {
    configureAliasesChanged = false;
    for (const [alias, initializer] of optionAliases) {
      const chain = expressionChain(initializer);
      if (chain === undefined) continue;
      const resolution = resolveApiChain(chain, rootAliases, controlAliases);
      if (
        resolution?.kind === 'root' &&
        (chain.members.includes('configure') ||
          configureAliases.has(chain.base)) &&
        !configureAliases.has(alias)
      ) {
        configureAliases.add(alias);
        configureAliasesChanged = true;
      }
    }
  }

  const recordViolation = (node: ts.Node, control: string) => {
    const location = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    const key = `${node.getStart(sourceFile)}:${control}`;
    if (recordedViolations.has(key)) return;
    recordedViolations.add(key);
    violations.push({
      column: location.character + 1,
      control,
      line: location.line + 1,
      sourcePath,
    });
  };

  const inspectOptions = (
    expression: ts.Expression,
    failClosed: boolean,
    visitedAliases: ReadonlySet<string> = new Set(),
  ): void => {
    const unwrapped = unwrapExpression(expression);
    if (ts.isIdentifier(unwrapped)) {
      const initializer = optionAliases.get(unwrapped.text);
      if (initializer === undefined || visitedAliases.has(unwrapped.text)) {
        if (failClosed) recordViolation(unwrapped, 'non-static test options');
        return;
      }
      inspectOptions(
        initializer,
        failClosed,
        new Set([...visitedAliases, unwrapped.text]),
      );
      return;
    }
    if (!ts.isObjectLiteralExpression(unwrapped)) {
      if (failClosed) recordViolation(unwrapped, 'non-static test options');
      return;
    }

    for (const property of unwrapped.properties) {
      if (ts.isSpreadAssignment(property)) {
        inspectOptions(property.expression, true, visitedAliases);
        continue;
      }
      const propertyName = staticPropertyName(property.name);
      if (propertyName === undefined) {
        if (failClosed) recordViolation(property, 'dynamic test option');
        continue;
      }
      if (forbiddenOptionPropertyNames.has(propertyName)) {
        recordViolation(property, `${propertyName} option`);
        continue;
      }
      if (!retryPropertyNames.has(propertyName)) continue;
      const allowed =
        ts.isPropertyAssignment(property) && isStaticZero(property.initializer);
      if (!allowed) recordViolation(property, `${propertyName} override`);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const chain = testApiCallChain(node.expression);
      const resolution =
        chain === undefined
          ? undefined
          : resolveApiChain(chain, rootAliases, controlAliases);
      if (resolution?.kind === 'root') {
        const lastMember = chain?.members.at(-1);
        const configureCall =
          chain?.members.includes('configure') === true ||
          configureAliases.has(chain?.base ?? '');
        const registrationCall =
          !configureCall &&
          (lastMember === undefined ||
            [
              'concurrent',
              'each',
              'effect',
              'live',
              'sequential',
              'test',
            ].includes(lastMember));

        for (const [index, argument] of node.arguments.entries()) {
          const thirdArgument = node.arguments[2];
          const unwrappedThirdArgument =
            thirdArgument === undefined
              ? undefined
              : unwrapExpression(thirdArgument);
          const literalHandlerInThirdPosition =
            unwrappedThirdArgument !== undefined &&
            (ts.isArrowFunction(unwrappedThirdArgument) ||
              ts.isFunctionExpression(unwrappedThirdArgument));
          const optionPosition =
            (configureCall && index === 0) ||
            (registrationCall &&
              index === 1 &&
              (literalHandlerInThirdPosition ||
                isStaticOptionsObject(argument)));
          if (optionPosition) inspectOptions(argument, true);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return violations;
};

const collectForbiddenControls = () => {
  const testSources = new Set(listRepositoryTestSources());
  return listRepositoryTestControlSources().flatMap((sourcePath) =>
    detectForbiddenTestControls(
      readFileSync(path.join(repositoryRoot, sourcePath), 'utf8'),
      sourcePath,
      testSources.has(sourcePath),
    ),
  );
};

const collectForbiddenTestConfigurations = () => {
  const testSources = new Set(listRepositoryTestSources());
  return listRepositoryTestControlSources().flatMap((sourcePath) => {
    const source = readFileSync(path.join(repositoryRoot, sourcePath), 'utf8');
    return detectForbiddenTestConfigurations(
      source,
      sourcePath,
      testSources.has(sourcePath),
    );
  });
};

describe('test control source', () => {
  it.each([
    ['direct skip', `test.skip('name', () => undefined)`],
    ['computed skip', `test['skip']('name', () => undefined)`],
    ['Effect conditional skip', `it.effect['skipIf'](true)('name', effect)`],
    ['root alias focus', `const check = test; check.only('name', body)`],
    [
      'derived test API skip',
      `const scoped = test.extend({}); scoped.skip('name', body)`,
    ],
    ['control alias', `const omitted = test.skip; omitted('name', body)`],
    [
      'destructured expected failure',
      `const { fails: expectedFailure } = it; expectedFailure('name', body)`,
    ],
    [
      'import alias todo',
      `import { it as check } from 'vitest'; check.todo('name')`,
    ],
    [
      'namespace import focus',
      `import * as v from 'vitest'; v.test.only('name', body)`,
    ],
    [
      'dynamic computed control',
      `const control = 'skip'; test[control]('name', body)`,
    ],
    [
      'dynamic destructured control alias',
      `const control = 'skip'; const { [control]: omitted } = test; omitted('name', body)`,
    ],
    ['setup skip', `setup.skip('name', body)`],
    ['Playwright callback fixme', `testInfo.fixme(true, 'reason')`],
    ['direct context skip', `skip('name', body)`],
  ])('detects %s', (_name, source) => {
    expect(
      detectForbiddenTestControls(source, 'fixture.ts').map(
        (violation) => violation.control,
      ),
    ).toHaveLength(1);
  });

  it('allows ordinary test APIs and unrelated object methods', () => {
    const source = `
test('active test', body);
test.each(cases)('matrix test', body);
it.effect('effect test', effect);
describe('active suite', body);
unrelated.skip('domain operation');
`;

    expect(detectForbiddenTestControls(source, 'fixture.ts')).toEqual([]);
  });

  it('scans imported Playwright fixture APIs in support modules without assuming unrelated globals are test controls', () => {
    const source = `
import { test as base } from '@playwright/test';
const scenario = base.extend({});
scenario.fixme('fixture', () => undefined);
const skip = () => undefined;
skip();
const test = { skip: () => undefined };
test.skip();
`;

    expect(
      detectForbiddenTestControls(
        source,
        'tests/support/fixture.ts',
        false,
      ).map((violation) => violation.control),
    ).toEqual(['fixme']);
  });

  it('detects Playwright testInfo controls in support helpers', () => {
    const source = `
export const configure = (testInfo: TestInfo) => {
  testInfo.skip(true, 'missing dependency');
};
`;

    expect(
      detectForbiddenTestControls(source, 'tests/support/helper.ts', false).map(
        (violation) => violation.control,
      ),
    ).toEqual(['skip']);
  });

  it('reports the exact source location and resolved alias control', () => {
    const [violation] = detectForbiddenTestControls(
      `const omitted = test['skip'];\nomitted('name', body);`,
      'fixture.ts',
    );

    expect(violation).toEqual({
      column: 1,
      control: 'skip',
      line: 2,
      sourcePath: 'fixture.ts',
    });
    expect(violation && formatControlViolation(violation)).toBe(
      'fixture.ts:2:1: forbidden test control skip',
    );
  });

  it.each([
    [
      'positive suite retries',
      `test.describe.configure({ mode: 'serial', retries: 1 })`,
    ],
    [
      'shorthand non-static retries',
      `const retries = 1; test.describe.configure({ retries })`,
    ],
    [
      'computed alias retries',
      `const configure = test['describe']['configure']; configure({ ['retries']: amount })`,
    ],
    ['Vitest per-test retry', `test('name', { retry: 2 }, () => undefined)`],
    [
      'aliased suite options',
      `const config = { retries: 1 }; test.describe.configure(config)`,
    ],
    [
      'aliased per-test options',
      `const options = { retry: 2 }; test('name', options, () => undefined)`,
    ],
    [
      'spread aliased options',
      `const base = { retry: 3 }; const options = { ...base }; test('name', options, () => undefined)`,
    ],
    [
      'unresolved spread options',
      `const options = { ...external }; test('name', options, () => undefined)`,
    ],
  ])('detects %s', (_name, source) => {
    expect(
      detectForbiddenTestConfigurations(source, 'fixture.ts'),
    ).toHaveLength(1);
  });

  it.each([
    ['skip', `test('name', { skip: true }, () => undefined)`],
    ['todo', `it('name', { todo: true }, () => undefined)`],
    ['only', `describe('name', { only: false }, () => undefined)`],
    ['fails', `test('name', { fails: true }, () => undefined)`],
  ])('detects the Vitest %s options-object control', (control, source) => {
    expect(
      detectForbiddenTestConfigurations(source, 'fixture.ts').map(
        (violation) => violation.control,
      ),
    ).toEqual([`${control} option`]);
  });

  it('detects forbidden controls through aliased and spread test options', () => {
    const source = `
const baseOptions = { skip: true };
const options = { ...baseOptions };
const handler = () => undefined;
test('name', options, handler);
`;

    expect(
      detectForbiddenTestConfigurations(source, 'fixture.ts').map(
        (violation) => violation.control,
      ),
    ).toEqual(['skip option']);
  });

  it('allows an explicit zero retry option', () => {
    expect(
      detectForbiddenTestConfigurations(
        `test('name', { retry: 0 }, () => undefined)`,
        'fixture.ts',
      ),
    ).toEqual([]);
    expect(
      detectForbiddenTestConfigurations(
        `const options = { retry: 0 }; test('name', options, () => undefined)`,
        'fixture.ts',
      ),
    ).toEqual([]);
  });

  it('includes Playwright fixture and helper modules in the control scan', () => {
    const controlSources = listRepositoryTestControlSources();

    expect(controlSources).toContain('tests/support/fixtures/base-test.ts');
    expect(controlSources).toContain(
      'tests/support/utils/registration-checkout-webhook.ts',
    );
  });

  it('keeps every collected test and runner support source active and unfocused', () => {
    const controlViolations = collectForbiddenControls();

    expect(
      controlViolations,
      `Forbidden test controls found:\n${controlViolations
        .map((violation) => formatControlViolation(violation))
        .join('\n')}`,
    ).toEqual([]);
    const configurationViolations = collectForbiddenTestConfigurations();
    expect(
      configurationViolations,
      `Forbidden test configurations found:\n${configurationViolations
        .map((violation) => formatControlViolation(violation))
        .join('\n')}`,
    ).toEqual([]);
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
    expect(playwrightConfig).toContain('resolvePlaywrightReporters');
    expect(playwrightConfig).toContain('reporter: reporters');
    expect(packageJson).toContain(
      '--reporter=./tests/support/reporters/protected-value-sanitizer-reporter.ts,github,dot,./tests/support/reporters/complete-playwright-run-reporter.ts',
    );
    expect(e2eWorkflow).toContain(
      '--reporter=./tests/support/reporters/protected-value-sanitizer-reporter.ts,github,dot,./tests/support/reporters/documentation-reporter.ts,./tests/support/reporters/complete-playwright-run-reporter.ts',
    );
  });
});
