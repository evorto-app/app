import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const appRoot = path.join(process.cwd(), 'src/app');
const visibleSharedFiles = [
  path.join(process.cwd(), 'src/shared/finance/receipt-countries.ts'),
] as const;
const visibleSharedCopyFiles = [
  path.join(process.cwd(), 'src/shared/event-check-in.ts'),
  path.join(process.cwd(), 'src/shared/event-discovery.ts'),
  path.join(process.cwd(), 'src/shared/finance/receipt-countries.ts'),
  path.join(process.cwd(), 'src/shared/finance/receipt-media.ts'),
  path.join(process.cwd(), 'src/shared/finance/reimbursement.ts'),
  path.join(process.cwd(), 'src/shared/permissions/permissions.ts'),
  path.join(process.cwd(), 'src/shared/price/format-inclusive-tax-label.ts'),
  path.join(process.cwd(), 'src/shared/registration-cancellation.ts'),
  path.join(process.cwd(), 'src/shared/registration-modes.ts'),
] as const;

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(entryPath);
    if (!entry.isFile()) return [];
    if (entry.name.endsWith('.html')) return [entryPath];
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      return [entryPath];
    }
    return [];
  });

const forbiddenProductPhrases = [
  'browser tab icon',
  'check your connection',
  "couldn't refresh this",
  'esncard refresh',
  'eligible cancellation refunds',
  'eligible discounts',
  'eligible events',
  'event details are read-only',
  'existing record',
  'in your browser',
  'internal id',
  'listing audience',
  'locked for editing',
  'manage your registration',
  'open this ticket again',
  'outside configured countries',
  'participant registration',
  'platform administrator',
  'public footer',
  'reassign this sign-up choice',
  'refresh pending reviews',
  'refund attempt',
  'register for an event',
  'registration approved',
  'registration cancelled',
  'registration confirmed',
  'registration option',
  'reopen this page',
  'review the form',
  'select refresh',
  'source of truth',
  'sign out and sign in again',
  'stripe checkout',
  'stripe payment',
  'tenant id',
  'transaction id',
  'unsaved form',
  'user id',
  'your registration',
] as const;

const implementationTerms =
  /\b(?:apis?|authentication|databases?|domains?|eligibility|eligible|endpoints?|fallbacks?|metadata|participants?|payloads?|providers?|register(?:ed|ing|s)?|registrations?|rpcs?|schemas?|stripe|tenants?|transactions?|webhooks?)\b|platform administrator|source of truth/giu;

const visiblePropertyNames = new Set([
  'body',
  'confirmLabel',
  'description',
  'dismissLabel',
  'emptyMessage',
  'failureMessage',
  'hint',
  'impact',
  'label',
  'message',
  'placeholder',
  'refund',
  'successMessage',
  'title',
]);

const staticAuthoredText = (initializer: ts.Expression): string | undefined => {
  if (ts.isStringLiteralLike(initializer)) return initializer.text;
  if (ts.isTemplateExpression(initializer)) {
    return [
      initializer.head.text,
      ...initializer.templateSpans.map(({ literal }) => literal.text),
    ].join(' ');
  }
  if (ts.isConditionalExpression(initializer)) {
    return [initializer.whenTrue, initializer.whenFalse]
      .flatMap((branch) => {
        const text = staticAuthoredText(branch);
        return text === undefined ? [] : [text];
      })
      .join(' ');
  }
  return;
};

const authoredApplicationCopy = (
  sourcePath: string,
): { line: number; text: string }[] => {
  const source = readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const copy: { line: number; text: string }[] = [];
  const add = (node: ts.Node, expression: ts.Expression): void => {
    const text = staticAuthoredText(expression);
    if (text === undefined) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    copy.push({ line: line + 1, text });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyAssignment(node)) {
      const propertyName =
        ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)
          ? node.name.text
          : undefined;
      if (propertyName && visiblePropertyNames.has(propertyName)) {
        add(node, node.initializer);
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ['showError', 'showSuccess'].includes(node.expression.name.text)
    ) {
      for (const argument of node.arguments) add(argument, argument);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return copy;
};

const authoredSharedCopy = (
  sourcePath: string,
): { line: number; text: string }[] => {
  const source = readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const copy = authoredApplicationCopy(sourcePath);
  const visit = (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) {
      const text = staticAuthoredText(node.expression);
      if (text !== undefined) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        copy.push({ line: line + 1, text });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return copy;
};

const removeTemplateTags = (source: string): string => {
  let output = '';
  let quote: "'" | '"' | null = null;
  let insideTag = false;
  for (const character of source) {
    if (!insideTag) {
      if (character === '<') {
        insideTag = true;
      } else {
        output += character;
      }
      continue;
    }
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      insideTag = false;
      output += ' ';
    }
  }
  return output;
};

const removeTemplateControlExpressions = (source: string): string => {
  const controlNames = [
    'case',
    'default',
    'else',
    'empty',
    'for',
    'if',
    'let',
    'switch',
  ];
  let output = '';
  for (let index = 0; index < source.length; index += 1) {
    const remainder = source.slice(index);
    const controlName = controlNames.find((name) =>
      remainder.startsWith(`@${name}`),
    );
    if (!controlName) {
      output += source[index];
      continue;
    }
    index += controlName.length + 1;
    while (/\s/u.test(source[index] ?? '')) index += 1;
    if (controlName === 'else' && source.slice(index).startsWith('if')) {
      index += 2;
      while (/\s/u.test(source[index] ?? '')) index += 1;
    }
    if (controlName === 'let') {
      while (index < source.length && source[index] !== ';') index += 1;
      output += ' ';
      continue;
    }
    if (source[index] !== '(') {
      output += ' ';
      index -= 1;
      continue;
    }
    let depth = 0;
    let quote: "'" | '"' | null = null;
    for (; index < source.length; index += 1) {
      const character = source[index];
      if (quote) {
        if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
        continue;
      }
      if (character === '(') {
        depth += 1;
        continue;
      }
      if (character === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    output += ' ';
  }
  return output;
};

const visibleTemplateCopy = (source: string): string => {
  const literalAttributes = [
    ...source.matchAll(
      /\b(?:aria-label|matTooltip|placeholder|title)="(?<copy>[^"]+)"/gu,
    ),
  ].map((match) => match.groups?.['copy'] ?? '');
  const text = removeTemplateTags(
    removeTemplateControlExpressions(
      source.replaceAll(/<!--[\s\S]*?-->/gu, ' '),
    ),
  )
    .replaceAll(/\{\{[\s\S]*?\}\}/gu, ' ')
    .replaceAll(/[{}]/gu, ' ');
  return [...literalAttributes, text].join(' ');
};

const authoredInlineTemplateCopy = (
  sourcePath: string,
): { line: number; text: string }[] => {
  const source = readFileSync(sourcePath, 'utf8');
  const sourceFile = ts.createSourceFile(
    sourcePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const copy: { line: number; text: string }[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ((ts.isIdentifier(node.name) && node.name.text === 'template') ||
        (ts.isStringLiteralLike(node.name) && node.name.text === 'template'))
    ) {
      const template = staticAuthoredText(node.initializer);
      if (template !== undefined) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile),
        );
        copy.push({ line: line + 1, text: visibleTemplateCopy(template) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return copy;
};

describe('plain product language', () => {
  it('keeps known implementation terms out of application copy', () => {
    const violations = [...sourceFiles(appRoot), ...visibleSharedFiles].flatMap(
      (sourcePath) => {
        const source = readFileSync(sourcePath, 'utf8').toLowerCase();
        return forbiddenProductPhrases
          .filter((phrase) => source.includes(phrase))
          .map(
            (phrase) =>
              `${path.relative(process.cwd(), sourcePath)}: ${phrase}`,
          );
      },
    );

    expect(violations).toEqual([]);
  });

  it('uses the real ellipsis character in visible templates', () => {
    const violations = sourceFiles(appRoot)
      .filter((sourcePath) => sourcePath.endsWith('.html'))
      .filter((sourcePath) => readFileSync(sourcePath, 'utf8').includes('...'))
      .map((sourcePath) => path.relative(process.cwd(), sourcePath));

    expect(violations).toEqual([]);
  });

  it('keeps implementation terms out of visible template and copy-helper text', () => {
    const templateViolations = sourceFiles(appRoot)
      .filter((sourcePath) => sourcePath.endsWith('.html'))
      .flatMap((sourcePath) =>
        [
          ...visibleTemplateCopy(readFileSync(sourcePath, 'utf8')).matchAll(
            implementationTerms,
          ),
        ].map(
          (match) => `${path.relative(process.cwd(), sourcePath)}: ${match[0]}`,
        ),
      );
    const helperViolations = sourceFiles(appRoot)
      .filter((sourcePath) => sourcePath.endsWith('.ts'))
      .flatMap((sourcePath) =>
        authoredApplicationCopy(sourcePath).flatMap(({ line, text }) =>
          [...text.matchAll(implementationTerms)].map(
            (match) =>
              `${path.relative(process.cwd(), sourcePath)}:${line}: ${match[0]}`,
          ),
        ),
      );
    const inlineTemplateViolations = sourceFiles(appRoot)
      .filter((sourcePath) => sourcePath.endsWith('.ts'))
      .flatMap((sourcePath) =>
        authoredInlineTemplateCopy(sourcePath).flatMap(({ line, text }) =>
          [...text.matchAll(implementationTerms)].map(
            (match) =>
              `${path.relative(process.cwd(), sourcePath)}:${line}: ${match[0]}`,
          ),
        ),
      );
    const sharedCopyViolations = visibleSharedCopyFiles.flatMap((sourcePath) =>
      authoredSharedCopy(sourcePath).flatMap(({ line, text }) =>
        [...text.matchAll(implementationTerms)].map(
          (match) =>
            `${path.relative(process.cwd(), sourcePath)}:${line}: ${match[0]}`,
        ),
      ),
    );

    expect([
      ...templateViolations,
      ...helperViolations,
      ...inlineTemplateViolations,
      ...sharedCopyViolations,
    ]).toEqual([]);
  });
});
