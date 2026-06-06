import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Source guard: generated documentation is product-facing, so these checks keep
// the docs tied to implemented flows instead of stale aspirational copy.
const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (path: string): string =>
  readFileSync(nodePath.join(repositoryRoot, path), 'utf8');

const findFiles = (path: string): string[] => {
  const absolutePath = nodePath.join(repositoryRoot, path);

  return readdirSync(absolutePath).flatMap((entry) => {
    const entryPath = nodePath.join(path, entry);
    const absoluteEntryPath = nodePath.join(repositoryRoot, entryPath);

    return statSync(absoluteEntryPath).isDirectory()
      ? findFiles(entryPath)
      : [entryPath];
  });
};

const unwrapExpression = (node: ts.Expression): ts.Expression => {
  let current = node;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }

  return current;
};

const collectDestructuredLocatorAliases = (
  node: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  propertyAliases: ReadonlySet<string>,
  aliases: Set<string>,
): void => {
  if (
    !ts.isObjectBindingPattern(node.name) ||
    !node.initializer ||
    !ts.isIdentifier(unwrapExpression(node.initializer))
  ) {
    return;
  }

  const sourceObject = unwrapExpression(node.initializer);

  if (!ts.isIdentifier(sourceObject)) {
    return;
  }

  for (const element of node.name.elements) {
    if (!ts.isIdentifier(element.name)) {
      continue;
    }

    const propertyName = element.propertyName ?? element.name;

    if (!ts.isIdentifier(propertyName) && !ts.isStringLiteral(propertyName)) {
      continue;
    }

    if (propertyAliases.has(`${sourceObject.text}.${propertyName.text}`)) {
      aliases.add(element.name.text);
    }
  }
};

const isTakeScreenshotCall = (node: ts.CallExpression): boolean => {
  const callee = unwrapExpression(node.expression);

  return ts.isIdentifier(callee) && callee.text === 'takeScreenshot';
};

const getStaticPropertyName = (node: ts.Expression): null | string => {
  const expression = unwrapExpression(node);

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  if (ts.isElementAccessExpression(expression)) {
    const argument = unwrapExpression(expression.argumentExpression);

    if (
      ts.isStringLiteral(argument) ||
      ts.isNoSubstitutionTemplateLiteral(argument)
    ) {
      return argument.text;
    }
  }

  return null;
};

const getStaticPropertyReceiver = (
  node: ts.Expression,
): null | ts.Expression => {
  const expression = unwrapExpression(node);

  if (
    ts.isPropertyAccessExpression(expression) ||
    ts.isElementAccessExpression(expression)
  ) {
    return expression.expression;
  }

  return null;
};

const findWeakScreenshotCaptions = (path: string, source: string): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const weakCaptions: string[] = [];

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const getCaptionText = (node: ts.Expression): null | string => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text.trim();
    }

    return null;
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTakeScreenshotCall(node)) {
      const caption = node.arguments[3];
      const captionText = caption ? getCaptionText(caption) : null;

      if (
        !captionText ||
        captionText.length < 24 ||
        captionText.split(/\s+/u).filter(Boolean).length < 4
      ) {
        weakCaptions.push(describeCall(node));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return weakCaptions;
};

const collectScreenshotCaptions = (
  path: string,
  source: string,
): Map<string, string[]> => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const captions = new Map<string, string[]>();

  const describeCall = (node: ts.Expression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const addCaption = (caption: string, location: string): void => {
    const existingLocations = captions.get(caption) ?? [];
    captions.set(caption, [...existingLocations, location]);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTakeScreenshotCall(node)) {
      const caption = node.arguments[3];

      if (
        caption &&
        (ts.isStringLiteral(caption) ||
          ts.isNoSubstitutionTemplateLiteral(caption))
      ) {
        addCaption(caption.text.trim(), describeCall(caption));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return captions;
};

const findGenericScreenshotTargets = (
  path: string,
  source: string,
): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const genericTargets: string[] = [];
  const genericTargetAliases = new Set<string>();
  const genericTargetPropertyAliases = new Set<string>();
  const genericTargetFunctions = new Set<string>();
  const genericSelectors = new Set([
    '*',
    ':root',
    'app-root',
    'body',
    'body, html',
    'html',
    'html, body',
    'main',
  ]);

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const isGenericLocatorTarget = (node: ts.Expression): boolean => {
    const target = unwrapExpression(node);

    if (ts.isArrayLiteralExpression(target)) {
      return (
        target.elements.length === 0 ||
        target.elements.some((element) => isGenericLocatorTarget(element))
      );
    }

    if (ts.isIdentifier(target)) {
      return genericTargetAliases.has(target.text);
    }

    if (ts.isPropertyAccessExpression(target)) {
      return genericTargetPropertyAliases.has(target.getText(sourceFile));
    }

    if (
      ts.isCallExpression(target) &&
      ts.isIdentifier(target.expression) &&
      genericTargetFunctions.has(target.expression.text)
    ) {
      return true;
    }

    if (
      ts.isCallExpression(target) &&
      ts.isPropertyAccessExpression(target.expression) &&
      target.expression.name.text === 'locator'
    ) {
      const selector = target.arguments[0];
      if (ts.isStringLiteral(selector)) {
        return genericSelectors.has(selector.text.trim().toLowerCase());
      }
    }

    return false;
  };

  const returnsGenericLocator = (
    node: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
  ): boolean => {
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      return isGenericLocatorTarget(node.body);
    }

    if (!ts.isBlock(node.body)) {
      return false;
    }

    let returnsGenericTarget = false;

    const visitReturn = (child: ts.Node): void => {
      if (
        ts.isReturnStatement(child) &&
        child.expression &&
        isGenericLocatorTarget(child.expression)
      ) {
        returnsGenericTarget = true;
      }

      ts.forEachChild(child, visitReturn);
    };

    visitReturn(node.body);

    return returnsGenericTarget;
  };

  const collectAliases = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isGenericLocatorTarget(unwrapExpression(node.initializer))
    ) {
      genericTargetAliases.add(node.name.text);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const objectInitializer = unwrapExpression(node.initializer);

      if (ts.isObjectLiteralExpression(objectInitializer)) {
        for (const property of objectInitializer.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)) &&
            isGenericLocatorTarget(unwrapExpression(property.initializer))
          ) {
            genericTargetPropertyAliases.add(
              `${node.name.text}.${property.name.text}`,
            );
          }
        }
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      isGenericLocatorTarget(unwrapExpression(node.right))
    ) {
      genericTargetPropertyAliases.add(node.left.getText(sourceFile));
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredLocatorAliases(
        node,
        sourceFile,
        genericTargetPropertyAliases,
        genericTargetAliases,
      );
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      returnsGenericLocator(node.initializer)
    ) {
      genericTargetFunctions.add(node.name.text);
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      returnsGenericLocator(node)
    ) {
      genericTargetFunctions.add(node.name.text);
    }

    ts.forEachChild(node, collectAliases);
  };

  const inspectScreenshotCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTakeScreenshotCall(node)) {
      const target = node.arguments[1];

      if (!target || isGenericLocatorTarget(target)) {
        genericTargets.push(describeCall(node));
      }
    }

    ts.forEachChild(node, inspectScreenshotCalls);
  };

  collectAliases(sourceFile);
  inspectScreenshotCalls(sourceFile);

  return genericTargets;
};

const findUnfilteredBroadScreenshotTargets = (
  path: string,
  source: string,
): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const broadTargets: string[] = [];
  const broadTargetAliases = new Set<string>();
  const broadTargetPropertyAliases = new Set<string>();
  const broadTargetFunctions = new Set<string>();
  const broadSelectors = new Set(['article', 'div', 'form', 'section']);

  const isBroadSelector = (selector: string): boolean => {
    const normalizedSelector = selector.trim().toLowerCase();

    return (
      broadSelectors.has(normalizedSelector) ||
      /^app-[a-z0-9-]+$/u.test(normalizedSelector)
    );
  };

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const isUnfilteredBroadLocatorTarget = (node: ts.Expression): boolean => {
    const target = unwrapExpression(node);

    if (ts.isArrayLiteralExpression(target)) {
      return target.elements.some((element) =>
        isUnfilteredBroadLocatorTarget(element),
      );
    }

    if (ts.isIdentifier(target)) {
      return broadTargetAliases.has(target.text);
    }

    if (ts.isPropertyAccessExpression(target)) {
      return broadTargetPropertyAliases.has(target.getText(sourceFile));
    }

    if (
      ts.isCallExpression(target) &&
      ts.isIdentifier(target.expression) &&
      broadTargetFunctions.has(target.expression.text)
    ) {
      return true;
    }

    let candidate: ts.Expression = target;
    let hasFilteringStep = false;

    while (
      ts.isCallExpression(candidate) &&
      ts.isPropertyAccessExpression(candidate.expression)
    ) {
      const methodName = candidate.expression.name.text;

      if (methodName === 'filter') {
        hasFilteringStep = true;
      }

      if (methodName === 'locator') {
        const selector = candidate.arguments[0];

        return (
          !hasFilteringStep &&
          ts.isStringLiteral(selector) &&
          isBroadSelector(selector.text)
        );
      }

      candidate = candidate.expression.expression;
    }

    return false;
  };

  const returnsUnfilteredBroadLocator = (
    node: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
  ): boolean => {
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      return isUnfilteredBroadLocatorTarget(node.body);
    }

    if (!ts.isBlock(node.body)) {
      return false;
    }

    let returnsBroadLocator = false;

    const visitReturn = (child: ts.Node): void => {
      if (
        ts.isReturnStatement(child) &&
        child.expression &&
        isUnfilteredBroadLocatorTarget(child.expression)
      ) {
        returnsBroadLocator = true;
      }

      ts.forEachChild(child, visitReturn);
    };

    visitReturn(node.body);

    return returnsBroadLocator;
  };

  const collectAliases = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isUnfilteredBroadLocatorTarget(unwrapExpression(node.initializer))
    ) {
      broadTargetAliases.add(node.name.text);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const objectInitializer = unwrapExpression(node.initializer);

      if (ts.isObjectLiteralExpression(objectInitializer)) {
        for (const property of objectInitializer.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)) &&
            isUnfilteredBroadLocatorTarget(
              unwrapExpression(property.initializer),
            )
          ) {
            broadTargetPropertyAliases.add(
              `${node.name.text}.${property.name.text}`,
            );
          }
        }
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      isUnfilteredBroadLocatorTarget(unwrapExpression(node.right))
    ) {
      broadTargetPropertyAliases.add(node.left.getText(sourceFile));
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredLocatorAliases(
        node,
        sourceFile,
        broadTargetPropertyAliases,
        broadTargetAliases,
      );
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      returnsUnfilteredBroadLocator(node.initializer)
    ) {
      broadTargetFunctions.add(node.name.text);
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      returnsUnfilteredBroadLocator(node)
    ) {
      broadTargetFunctions.add(node.name.text);
    }

    ts.forEachChild(node, collectAliases);
  };

  const inspectScreenshotCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTakeScreenshotCall(node)) {
      const target = node.arguments[1];

      if (target && isUnfilteredBroadLocatorTarget(target)) {
        broadTargets.push(describeCall(node));
      }
    }

    ts.forEachChild(node, inspectScreenshotCalls);
  };

  collectAliases(sourceFile);
  inspectScreenshotCalls(sourceFile);

  return broadTargets;
};

const findSingleControlScreenshotTargets = (
  path: string,
  source: string,
): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const singleControlTargets: string[] = [];
  const singleControlAliases = new Set<string>();
  const singleControlPropertyAliases = new Set<string>();
  const singleControlFunctions = new Set<string>();
  const singleControlCssSelectors = new Set([
    'a',
    'button',
    'input',
    'mat-checkbox',
    'mat-form-field',
    'mat-option',
    'mat-radio-button',
    'mat-select',
    'mat-slide-toggle',
    'select',
    'textarea',
  ]);
  const singleControlRoles = new Set([
    'button',
    'cell',
    'checkbox',
    'columnheader',
    'combobox',
    'gridcell',
    'heading',
    'link',
    'menuitem',
    'option',
    'radio',
    'rowheader',
    'searchbox',
    'spinbutton',
    'switch',
    'tab',
    'textbox',
  ]);
  const singleControlCssSelectorPatterns = [
    /^\[role=(?:"|')?(?:button|checkbox|combobox|link|menuitem|option|radio|searchbox|switch|tab|textbox)(?:"|')?\]/u,
    /^\.mat-mdc-(?:button|checkbox|form-field|icon-button|radio-button|select|slide-toggle)(?:\b|[_-])/u,
    /^\.mdc-(?:button|checkbox|radio|switch|text-field)(?:\b|[_-])/u,
  ];
  const singleControlTestIdPattern =
    /(?:^|[-_])(?:action|button|checkbox|combobox|field|icon-button|input|link|menuitem|option|radio|searchbox|select|submit|switch|tab|textarea|textbox)(?:$|[-_])/u;

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const getStringLiteralText = (node: ts.Expression): null | string => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text.trim().toLowerCase();
    }

    return null;
  };

  const isSingleControlCssSelector = (selector: string): boolean => {
    const normalizedSelector = selector.trim().toLowerCase();
    const selectorHead = normalizedSelector
      .split(/\s|>|\+|~|:|\.|#|\[/u, 1)[0]
      ?.trim();

    return (
      (selectorHead ? singleControlCssSelectors.has(selectorHead) : false) ||
      singleControlCssSelectorPatterns.some((pattern) =>
        pattern.test(normalizedSelector),
      )
    );
  };

  const isSingleControlLocatorTarget = (node: ts.Expression): boolean => {
    const target = unwrapExpression(node);

    if (ts.isArrayLiteralExpression(target)) {
      return target.elements.some((element) =>
        isSingleControlLocatorTarget(element),
      );
    }

    if (ts.isIdentifier(target)) {
      return singleControlAliases.has(target.text);
    }

    if (ts.isPropertyAccessExpression(target)) {
      return singleControlPropertyAliases.has(target.getText(sourceFile));
    }

    if (
      ts.isCallExpression(target) &&
      ts.isIdentifier(target.expression) &&
      singleControlFunctions.has(target.expression.text)
    ) {
      return true;
    }

    let candidate: ts.Expression = target;

    while (
      ts.isCallExpression(candidate) &&
      ts.isPropertyAccessExpression(candidate.expression)
    ) {
      const methodName = candidate.expression.name.text;

      if (methodName === 'getByRole') {
        const role = candidate.arguments[0]
          ? getStringLiteralText(candidate.arguments[0])
          : null;

        return role ? singleControlRoles.has(role) : false;
      }

      if (methodName === 'locator') {
        const selector = candidate.arguments[0];
        if (
          selector &&
          (ts.isStringLiteral(selector) ||
            ts.isNoSubstitutionTemplateLiteral(selector))
        ) {
          return isSingleControlCssSelector(selector.text);
        }
      }

      if (
        methodName === 'getByText' ||
        methodName === 'getByLabel' ||
        methodName === 'getByPlaceholder'
      ) {
        return true;
      }

      if (methodName === 'getByTestId') {
        const testId = candidate.arguments[0]
          ? getStringLiteralText(candidate.arguments[0])
          : null;

        return testId ? singleControlTestIdPattern.test(testId) : false;
      }

      candidate = candidate.expression.expression;
    }

    return false;
  };

  const returnsSingleControlLocator = (
    node: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
  ): boolean => {
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      return isSingleControlLocatorTarget(node.body);
    }

    if (!ts.isBlock(node.body)) {
      return false;
    }

    let returnsSingleControl = false;

    const visitReturn = (child: ts.Node): void => {
      if (
        ts.isReturnStatement(child) &&
        child.expression &&
        isSingleControlLocatorTarget(child.expression)
      ) {
        returnsSingleControl = true;
      }

      ts.forEachChild(child, visitReturn);
    };

    visitReturn(node.body);

    return returnsSingleControl;
  };

  const collectAliases = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isSingleControlLocatorTarget(unwrapExpression(node.initializer))
    ) {
      singleControlAliases.add(node.name.text);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const objectInitializer = unwrapExpression(node.initializer);

      if (ts.isObjectLiteralExpression(objectInitializer)) {
        for (const property of objectInitializer.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)) &&
            isSingleControlLocatorTarget(unwrapExpression(property.initializer))
          ) {
            singleControlPropertyAliases.add(
              `${node.name.text}.${property.name.text}`,
            );
          }
        }
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      isSingleControlLocatorTarget(unwrapExpression(node.right))
    ) {
      singleControlPropertyAliases.add(node.left.getText(sourceFile));
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredLocatorAliases(
        node,
        sourceFile,
        singleControlPropertyAliases,
        singleControlAliases,
      );
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      returnsSingleControlLocator(node.initializer)
    ) {
      singleControlFunctions.add(node.name.text);
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      returnsSingleControlLocator(node)
    ) {
      singleControlFunctions.add(node.name.text);
    }

    ts.forEachChild(node, collectAliases);
  };

  const inspectScreenshotCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTakeScreenshotCall(node)) {
      const target = node.arguments[1];

      if (target && isSingleControlLocatorTarget(target)) {
        singleControlTargets.push(describeCall(node));
      }
    }

    ts.forEachChild(node, inspectScreenshotCalls);
  };

  collectAliases(sourceFile);
  inspectScreenshotCalls(sourceFile);

  return singleControlTargets;
};

const findIconOrMediaScreenshotTargets = (
  path: string,
  source: string,
): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const iconOrMediaTargets: string[] = [];
  const iconOrMediaAliases = new Set<string>();
  const iconOrMediaPropertyAliases = new Set<string>();
  const iconOrMediaFunctions = new Set<string>();
  const iconOrMediaCssSelectors = new Set([
    'canvas',
    'fa-icon',
    'img',
    'mat-icon',
    'picture',
    'svg',
    'video',
  ]);
  const iconOrMediaCssSelectorPatterns = [
    /^\.fa(?:\b|-)/u,
    /^\.mat-icon(?:\b|[_-])/u,
    /^\[(?:alt|src)(?:\]|[~|^$*]?=)/u,
  ];
  const iconOrMediaRoles = new Set(['img']);

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const isIconOrMediaCssSelector = (selector: string): boolean => {
    const normalizedSelector = selector.trim().toLowerCase();
    const selectorHead = normalizedSelector
      .split(/\s|>|\+|~|:|\.|#|\[/u, 1)[0]
      ?.trim();

    return (
      (selectorHead ? iconOrMediaCssSelectors.has(selectorHead) : false) ||
      iconOrMediaCssSelectorPatterns.some((pattern) =>
        pattern.test(normalizedSelector),
      )
    );
  };

  const isIconOrMediaLocatorTarget = (node: ts.Expression): boolean => {
    const target = unwrapExpression(node);

    if (ts.isArrayLiteralExpression(target)) {
      return target.elements.some((element) =>
        isIconOrMediaLocatorTarget(element),
      );
    }

    if (ts.isIdentifier(target)) {
      return iconOrMediaAliases.has(target.text);
    }

    if (ts.isPropertyAccessExpression(target)) {
      return iconOrMediaPropertyAliases.has(target.getText(sourceFile));
    }

    if (
      ts.isCallExpression(target) &&
      ts.isIdentifier(target.expression) &&
      iconOrMediaFunctions.has(target.expression.text)
    ) {
      return true;
    }

    let candidate: ts.Expression = target;

    while (
      ts.isCallExpression(candidate) &&
      ts.isPropertyAccessExpression(candidate.expression)
    ) {
      const methodName = candidate.expression.name.text;

      if (methodName === 'locator') {
        const selector = candidate.arguments[0];
        if (
          selector &&
          (ts.isStringLiteral(selector) ||
            ts.isNoSubstitutionTemplateLiteral(selector))
        ) {
          return isIconOrMediaCssSelector(selector.text);
        }
      }

      if (methodName === 'getByRole') {
        const role = candidate.arguments[0];
        if (
          role &&
          (ts.isStringLiteral(role) || ts.isNoSubstitutionTemplateLiteral(role))
        ) {
          return iconOrMediaRoles.has(role.text.trim().toLowerCase());
        }
      }

      if (methodName === 'getByAltText' || methodName === 'getByTitle') {
        return true;
      }

      candidate = candidate.expression.expression;
    }

    return false;
  };

  const returnsIconOrMediaLocator = (
    node: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
  ): boolean => {
    if (ts.isArrowFunction(node) && !ts.isBlock(node.body)) {
      return isIconOrMediaLocatorTarget(node.body);
    }

    if (!ts.isBlock(node.body)) {
      return false;
    }

    let returnsIconOrMedia = false;

    const visitReturn = (child: ts.Node): void => {
      if (
        ts.isReturnStatement(child) &&
        child.expression &&
        isIconOrMediaLocatorTarget(child.expression)
      ) {
        returnsIconOrMedia = true;
      }

      ts.forEachChild(child, visitReturn);
    };

    visitReturn(node.body);

    return returnsIconOrMedia;
  };

  const collectAliases = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isIconOrMediaLocatorTarget(unwrapExpression(node.initializer))
    ) {
      iconOrMediaAliases.add(node.name.text);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const objectInitializer = unwrapExpression(node.initializer);

      if (ts.isObjectLiteralExpression(objectInitializer)) {
        for (const property of objectInitializer.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            (ts.isIdentifier(property.name) ||
              ts.isStringLiteral(property.name)) &&
            isIconOrMediaLocatorTarget(unwrapExpression(property.initializer))
          ) {
            iconOrMediaPropertyAliases.add(
              `${node.name.text}.${property.name.text}`,
            );
          }
        }
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isPropertyAccessExpression(node.left) &&
      isIconOrMediaLocatorTarget(unwrapExpression(node.right))
    ) {
      iconOrMediaPropertyAliases.add(node.left.getText(sourceFile));
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredLocatorAliases(
        node,
        sourceFile,
        iconOrMediaPropertyAliases,
        iconOrMediaAliases,
      );
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) ||
        ts.isFunctionExpression(node.initializer)) &&
      returnsIconOrMediaLocator(node.initializer)
    ) {
      iconOrMediaFunctions.add(node.name.text);
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      returnsIconOrMediaLocator(node)
    ) {
      iconOrMediaFunctions.add(node.name.text);
    }

    ts.forEachChild(node, collectAliases);
  };

  const inspectScreenshotCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTakeScreenshotCall(node)) {
      const target = node.arguments[1];

      if (target && isIconOrMediaLocatorTarget(target)) {
        iconOrMediaTargets.push(describeCall(node));
      }
    }

    ts.forEachChild(node, inspectScreenshotCalls);
  };

  collectAliases(sourceFile);
  inspectScreenshotCalls(sourceFile);

  return iconOrMediaTargets;
};

const countTakeScreenshotCalls = (path: string, source: string): number => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let screenshotCount = 0;

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isTakeScreenshotCall(node)) {
      screenshotCount += 1;
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return screenshotCount;
};

const importsSharedScreenshotHelper = (
  path: string,
  source: string,
): boolean => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let importsHelper = false;

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text ===
        '../../support/reporters/documentation-reporter'
    ) {
      const namedBindings = node.importClause?.namedBindings;
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        importsHelper = namedBindings.elements.some(
          (element) => element.name.text === 'takeScreenshot',
        );
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return importsHelper;
};

const findScreenshotHelperBypasses = (
  path: string,
  source: string,
): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const bypasses: string[] = [];

  const describeNode = (node: ts.Node): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const isScreenshotLikeIdentifier = (name: ts.BindingName): boolean =>
    ts.isIdentifier(name) && /screenshot/iu.test(name.text);

  const expressionReferencesTakeScreenshot = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node) && node.text === 'takeScreenshot') {
      return true;
    }

    let referencesHelper = false;

    ts.forEachChild(node, (child) => {
      if (expressionReferencesTakeScreenshot(child)) {
        referencesHelper = true;
      }
    });

    return referencesHelper;
  };

  const functionCallsTakeScreenshot = (
    node: ts.ArrowFunction | ts.FunctionDeclaration | ts.FunctionExpression,
  ): boolean => {
    let callsHelper = false;

    ts.forEachChild(node.body, (child) => {
      if (expressionReferencesTakeScreenshot(child)) {
        callsHelper = true;
      }
    });

    return callsHelper;
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const moduleSpecifier = node.moduleSpecifier.text;
      const namedBindings = node.importClause?.namedBindings;

      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const element of namedBindings.elements) {
          const importedName = element.propertyName?.text ?? element.name.text;
          const localName = element.name.text;

          if (
            moduleSpecifier.includes(
              'documentation-reporter/take-screenshot',
            ) &&
            importedName === 'takeScreenshot'
          ) {
            bypasses.push(describeNode(element));
          }

          if (
            moduleSpecifier ===
              '../../support/reporters/documentation-reporter' &&
            importedName === 'takeScreenshot' &&
            localName !== 'takeScreenshot'
          ) {
            bypasses.push(describeNode(element));
          }
        }
      }

      if (
        namedBindings &&
        ts.isNamespaceImport(namedBindings) &&
        (moduleSpecifier === '../../support/reporters/documentation-reporter' ||
          moduleSpecifier.includes('documentation-reporter/take-screenshot'))
      ) {
        bypasses.push(describeNode(namedBindings.name));
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);

      if (
        callee.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        (node.arguments[0].text ===
          '../../support/reporters/documentation-reporter' ||
          node.arguments[0].text.includes(
            'documentation-reporter/take-screenshot',
          ))
      ) {
        bypasses.push(describeNode(node.expression));
      }

      if (
        (ts.isPropertyAccessExpression(callee) ||
          ts.isElementAccessExpression(callee)) &&
        getStaticPropertyName(callee) === 'takeScreenshot'
      ) {
        bypasses.push(describeNode(node.expression));
      }
    }

    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      (/screenshot/iu.test(node.name.text) || functionCallsTakeScreenshot(node))
    ) {
      bypasses.push(describeNode(node.name));
    }

    if (
      ts.isVariableDeclaration(node) &&
      (isScreenshotLikeIdentifier(node.name) ||
        (node.initializer &&
          expressionReferencesTakeScreenshot(node.initializer)))
    ) {
      bypasses.push(describeNode(node.name));
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return bypasses;
};

const findDirectImageAttachmentCalls = (
  path: string,
  source: string,
): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imageAttachments: string[] = [];
  const imageAttachmentNameAliases = new Set<string>();
  const imageAttachmentPayloadAliases = new Set<string>();
  const attachFunctionAliases = new Set<string>();

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const getStringLiteralText = (node: ts.Expression): null | string => {
    const expression = unwrapExpression(node);

    if (
      ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)
    ) {
      return expression.text;
    }

    return null;
  };

  const isImageAttachmentName = (node: ts.Expression): boolean => {
    const expression = unwrapExpression(node);

    if (ts.isIdentifier(expression)) {
      return imageAttachmentNameAliases.has(expression.text);
    }

    return getStringLiteralText(expression) === 'image';
  };

  const isImageAttachmentPayload = (node: ts.Expression): boolean => {
    const payload = unwrapExpression(node);

    if (ts.isIdentifier(payload)) {
      return imageAttachmentPayloadAliases.has(payload.text);
    }

    if (!ts.isObjectLiteralExpression(payload)) {
      return false;
    }

    return payload.properties.some((property) => {
      if (
        !ts.isPropertyAssignment(property) ||
        (!ts.isIdentifier(property.name) &&
          !ts.isStringLiteral(property.name)) ||
        (property.name.text !== 'contentType' && property.name.text !== 'path')
      ) {
        return false;
      }

      const propertyValue = getStringLiteralText(property.initializer);

      if (!propertyValue) {
        return false;
      }

      if (property.name.text === 'contentType') {
        return propertyValue.trim().toLowerCase().startsWith('image/');
      }

      return /\.(?:avif|gif|jpe?g|png|webp)$/iu.test(propertyValue.trim());
    });
  };

  const isAttachFunctionReference = (node: ts.Expression): boolean => {
    const expression = unwrapExpression(node);

    if (
      (ts.isPropertyAccessExpression(expression) ||
        ts.isElementAccessExpression(expression)) &&
      getStaticPropertyName(expression) === 'attach'
    ) {
      return true;
    }

    if (
      ts.isCallExpression(expression) &&
      getStaticPropertyName(expression.expression) === 'bind' &&
      getStaticPropertyName(
        getStaticPropertyReceiver(expression.expression) ??
          expression.expression,
      ) === 'attach'
    ) {
      return true;
    }

    return false;
  };

  const addAttachBindingAliases = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      attachFunctionAliases.add(name.text);
      return;
    }

    for (const element of name.elements) {
      if (ts.isIdentifier(element.name)) {
        attachFunctionAliases.add(element.name.text);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      if (getStringLiteralText(node.initializer) === 'image') {
        imageAttachmentNameAliases.add(node.name.text);
      }

      if (isImageAttachmentPayload(node.initializer)) {
        imageAttachmentPayloadAliases.add(node.name.text);
      }

      if (isAttachFunctionReference(node.initializer)) {
        attachFunctionAliases.add(node.name.text);
      }
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const element of node.name.elements) {
        const propertyName = element.propertyName ?? element.name;

        if (
          (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)) &&
          propertyName.text === 'attach'
        ) {
          addAttachBindingAliases(element.name);
        }
      }
    }

    if (
      ts.isCallExpression(node) &&
      node.arguments[0] &&
      (isImageAttachmentName(node.arguments[0]) ||
        (node.arguments[1] && isImageAttachmentPayload(node.arguments[1])))
    ) {
      const callee = unwrapExpression(node.expression);

      if (
        ((ts.isPropertyAccessExpression(callee) ||
          ts.isElementAccessExpression(callee)) &&
          getStaticPropertyName(callee) === 'attach') ||
        (ts.isIdentifier(callee) && attachFunctionAliases.has(callee.text))
      ) {
        imageAttachments.push(describeCall(node));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return imageAttachments;
};

const findDirectScreenshotCalls = (path: string, source: string): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const screenshotCalls: string[] = [];
  const screenshotFunctionAliases = new Set<string>();

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const isScreenshotFunctionReference = (node: ts.Expression): boolean => {
    const expression = unwrapExpression(node);

    if (
      (ts.isPropertyAccessExpression(expression) ||
        ts.isElementAccessExpression(expression)) &&
      getStaticPropertyName(expression) === 'screenshot'
    ) {
      return true;
    }

    if (
      ts.isCallExpression(expression) &&
      getStaticPropertyName(expression.expression) === 'bind' &&
      getStaticPropertyName(
        getStaticPropertyReceiver(expression.expression) ??
          expression.expression,
      ) === 'screenshot'
    ) {
      return true;
    }

    return false;
  };

  const addScreenshotBindingAliases = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      screenshotFunctionAliases.add(name.text);
      return;
    }

    for (const element of name.elements) {
      if (ts.isIdentifier(element.name)) {
        screenshotFunctionAliases.add(element.name.text);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isScreenshotFunctionReference(node.initializer)
    ) {
      screenshotFunctionAliases.add(node.name.text);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name)
    ) {
      for (const element of node.name.elements) {
        const propertyName = element.propertyName ?? element.name;

        if (
          (ts.isIdentifier(propertyName) || ts.isStringLiteral(propertyName)) &&
          propertyName.text === 'screenshot'
        ) {
          addScreenshotBindingAliases(element.name);
        }
      }
    }

    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);

      if (
        ((ts.isPropertyAccessExpression(callee) ||
          ts.isElementAccessExpression(callee)) &&
          getStaticPropertyName(callee) === 'screenshot') ||
        (ts.isIdentifier(callee) && screenshotFunctionAliases.has(callee.text))
      ) {
        screenshotCalls.push(describeCall(node));
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return screenshotCalls;
};

describe('generated docs source current behavior', () => {
  it('detects screenshot helper bypass patterns before generated docs can use them', () => {
    const bypassSource = `
      import { takeScreenshot as grabImage } from '../../support/reporters/documentation-reporter';
      import { takeScreenshot } from '../../support/reporters/documentation-reporter/take-screenshot';
      import * as documentationReporter from '../../support/reporters/documentation-reporter';
      import * as directScreenshotHelper from '../../support/reporters/documentation-reporter/take-screenshot';

      const captureScreenshotEvidence = takeScreenshot;
      const captureDocumentationImage = takeScreenshot;

      function localScreenshot() {
        return captureScreenshotEvidence;
      }

      function captureDocumentationImageLater() {
        return takeScreenshot;
      }

      await documentationReporter.takeScreenshot(
        testInfo,
        settingsSurface,
        page,
        'Namespace helper call with descriptive caption',
      );
      await directScreenshotHelper.takeScreenshot(
        testInfo,
        settingsSurface,
        page,
        'Direct namespace helper call with descriptive caption',
      );
      await documentationReporter['takeScreenshot'](
        testInfo,
        settingsSurface,
        page,
        'Bracket namespace helper call with descriptive caption',
      );

      async function dynamicImportBypass() {
        const dynamicReporter = await import('../../support/reporters/documentation-reporter');
        const dynamicDirectHelper = await import('../../support/reporters/documentation-reporter/take-screenshot');
        return [dynamicReporter, dynamicDirectHelper];
      }
    `;

    expect(
      findScreenshotHelperBypasses(
        'tests/docs/example/bypass.doc.ts',
        bypassSource,
      ),
    ).toEqual([
      'tests/docs/example/bypass.doc.ts:2:16',
      'tests/docs/example/bypass.doc.ts:3:16',
      'tests/docs/example/bypass.doc.ts:4:19',
      'tests/docs/example/bypass.doc.ts:5:19',
      'tests/docs/example/bypass.doc.ts:7:13',
      'tests/docs/example/bypass.doc.ts:8:13',
      'tests/docs/example/bypass.doc.ts:10:16',
      'tests/docs/example/bypass.doc.ts:14:16',
      'tests/docs/example/bypass.doc.ts:18:13',
      'tests/docs/example/bypass.doc.ts:24:13',
      'tests/docs/example/bypass.doc.ts:30:13',
      'tests/docs/example/bypass.doc.ts:38:39',
      'tests/docs/example/bypass.doc.ts:39:43',
    ]);
  });

  it('detects direct image attachments before generated docs can use them', () => {
    const directImageAttachmentSource = `
      await testInfo.attach('image', { body: imageBuffer });
      await testInfo.attach(\`image\`, { body: imageBuffer });
      const attachmentName = 'image';
      await testInfo.attach(attachmentName, { body: imageBuffer });
      const attachEvidence = testInfo.attach.bind(testInfo);
      await attachEvidence('image', { body: imageBuffer });
      const attachEvidenceByElement = testInfo['attach'].bind(testInfo);
      await attachEvidenceByElement('image', { body: imageBuffer });
      const { attach: attachImageDirectly } = testInfo;
      await attachImageDirectly('image', { body: imageBuffer });
      await testInfo['attach']('image', { body: imageBuffer });
      await testInfo.attach('raw evidence', { body: imageBuffer, contentType: 'image/png' });
      await testInfo.attach('raw file evidence', { path: 'raw-evidence.webp' });
      const rawImagePayload = { body: imageBuffer, contentType: 'image/jpeg' };
      await testInfo.attach('aliased raw evidence', rawImagePayload);
      const rawImagePathPayload = { path: 'aliased-raw-evidence.png' };
      await testInfo.attach('aliased raw file evidence', rawImagePathPayload);
      await testInfo.attach('markdown', { body: markdown });
    `;

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/direct-image.doc.ts',
        directImageAttachmentSource,
      ),
    ).toEqual([
      'tests/docs/example/direct-image.doc.ts:2:13',
      'tests/docs/example/direct-image.doc.ts:3:13',
      'tests/docs/example/direct-image.doc.ts:5:13',
      'tests/docs/example/direct-image.doc.ts:7:13',
      'tests/docs/example/direct-image.doc.ts:9:13',
      'tests/docs/example/direct-image.doc.ts:11:13',
      'tests/docs/example/direct-image.doc.ts:12:13',
      'tests/docs/example/direct-image.doc.ts:13:13',
      'tests/docs/example/direct-image.doc.ts:14:13',
      'tests/docs/example/direct-image.doc.ts:16:13',
      'tests/docs/example/direct-image.doc.ts:18:13',
    ]);
  });

  it('detects direct screenshot calls before generated docs can use them', () => {
    const directScreenshotSource = `
      await page.screenshot({ path: 'page.png' });
      await page['screenshot']({ path: 'page-bracket.png' });
      await page.locator('main').screenshot();
      const captureElement = page.locator('section').screenshot.bind(page.locator('section'));
      await captureElement({ path: 'section.png' });
      const capturePageByElement = page['screenshot'].bind(page);
      await capturePageByElement({ path: 'page-element-alias.png' });
      const { screenshot: capturePageScreenshot } = page;
      await capturePageScreenshot({ path: 'page-alias.png' });
      await takeScreenshot(
        testInfo,
        settingsSurface,
        page,
        'Shared helper screenshot remains the allowed path',
      );
    `;

    expect(
      findDirectScreenshotCalls(
        'tests/docs/example/direct-screenshot.doc.ts',
        directScreenshotSource,
      ),
    ).toEqual([
      'tests/docs/example/direct-screenshot.doc.ts:2:13',
      'tests/docs/example/direct-screenshot.doc.ts:3:13',
      'tests/docs/example/direct-screenshot.doc.ts:4:13',
      'tests/docs/example/direct-screenshot.doc.ts:6:13',
      'tests/docs/example/direct-screenshot.doc.ts:8:13',
      'tests/docs/example/direct-screenshot.doc.ts:10:13',
    ]);
  });

  it('inspects parenthesized documentation screenshot helper calls', () => {
    const parenthesizedHelperSource = `
      async function captureEvidence() {
        await (takeScreenshot)(
          testInfo,
          page.locator('main'),
          page,
          'Parenthesized generic shell target with a descriptive caption',
        );
        await (takeScreenshot)(
          testInfo,
          settingsSurface,
          page,
          'Too short',
        );
      }
    `;

    expect(
      countTakeScreenshotCalls(
        'tests/docs/example/parenthesized-helper.doc.ts',
        parenthesizedHelperSource,
      ),
    ).toBe(2);
    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/parenthesized-helper.doc.ts',
        parenthesizedHelperSource,
      ),
    ).toEqual(['tests/docs/example/parenthesized-helper.doc.ts:3:15']);
    expect(
      findWeakScreenshotCaptions(
        'tests/docs/example/parenthesized-helper.doc.ts',
        parenthesizedHelperSource,
      ),
    ).toEqual(['tests/docs/example/parenthesized-helper.doc.ts:9:15']);
  });

  it('detects destructured weak documentation screenshot target aliases', () => {
    const destructuredTargetSource = `
      const targets = {
        shell: page.locator('main'),
        broad: page.locator('section'),
        single: page.getByRole('button', { name: 'Save' }),
        icon: page.locator('svg'),
      };
      const { shell, broad, single, icon } = targets;

      await takeScreenshot(
        testInfo,
        shell,
        page,
        'Destructured generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        broad,
        page,
        'Destructured broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        single,
        page,
        'Destructured single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        icon,
        page,
        'Destructured icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/destructured-target.doc.ts',
        destructuredTargetSource,
      ),
    ).toEqual(['tests/docs/example/destructured-target.doc.ts:10:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/destructured-target.doc.ts',
        destructuredTargetSource,
      ),
    ).toEqual(['tests/docs/example/destructured-target.doc.ts:16:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/destructured-target.doc.ts',
        destructuredTargetSource,
      ),
    ).toEqual(['tests/docs/example/destructured-target.doc.ts:22:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/destructured-target.doc.ts',
        destructuredTargetSource,
      ),
    ).toEqual(['tests/docs/example/destructured-target.doc.ts:28:13']);
  });

  it('detects generic documentation screenshot targets', () => {
    const genericTargetSource = `
      await takeScreenshot(
        testInfo,
        page.locator('main'),
        page,
        'Generic application shell target with a descriptive caption',
      );
      const appRootShell = page.locator('app-root');
      await takeScreenshot(
        testInfo,
        [settingsSurface, appRootShell],
        page,
        'Aliased generic application shell target with a descriptive caption',
      );
      const mainShellSurface = (page) => page.locator('main');
      await takeScreenshot(
        testInfo,
        mainShellSurface(page),
        page,
        'Helper-returned generic shell target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/generic-target.doc.ts',
        genericTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/generic-target.doc.ts:2:13',
      'tests/docs/example/generic-target.doc.ts:9:13',
      'tests/docs/example/generic-target.doc.ts:16:13',
    ]);
  });

  it('detects unfiltered broad documentation screenshot targets', () => {
    const broadTargetSource = `
      await takeScreenshot(
        testInfo,
        page.locator('section'),
        page,
        'Broad page section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('div'),
        page,
        'Broad div target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('form').first(),
        page,
        'Broad form target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('app-user-profile'),
        page,
        'Broad component host target with a descriptive caption',
      );
      const aliasedBroadSection = page.locator('section');
      await takeScreenshot(
        testInfo,
        [tenantSettingsSurface, aliasedBroadSection],
        page,
        'Aliased broad section target with a descriptive caption',
      );
      const broadFormSurface = (page) => page.locator('form');
      await takeScreenshot(
        testInfo,
        broadFormSurface(page),
        page,
        'Helper-returned broad form target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('section').filter({ hasText: 'Registration' }),
        page,
        'Filtered registration section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('div').filter({ hasText: 'Registration unavailable' }),
        page,
        'Filtered registration state div target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('form').filter({ has: page.getByLabel('Tenant name') }),
        page,
        'Filtered form target with a descriptive caption',
      );
    `;

    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/broad-target.doc.ts',
        broadTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/broad-target.doc.ts:2:13',
      'tests/docs/example/broad-target.doc.ts:8:13',
      'tests/docs/example/broad-target.doc.ts:14:13',
      'tests/docs/example/broad-target.doc.ts:20:13',
      'tests/docs/example/broad-target.doc.ts:27:13',
      'tests/docs/example/broad-target.doc.ts:34:13',
    ]);
  });

  it('detects single-control documentation screenshot targets', () => {
    const singleControlTargetSource = `
      await takeScreenshot(
        testInfo,
        page.getByRole('button', { name: 'Create category' }),
        page,
        'Single button target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.getByRole('option', { name: 'Standard ticket' }),
        page,
        'Single option target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.getByRole('cell', { name: 'admin@evorto.app' }),
        page,
        'Single table cell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.getByText('Registration opens next week'),
        page,
        'Single text target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [page.getByLabel('Email address')],
        page,
        'Single array target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.getByPlaceholder('Search users'),
        page,
        'Single placeholder target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('button[data-action="save"]'),
        page,
        'Single CSS button target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('input[name="email"]'),
        page,
        'Single CSS input target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('[role="button"][aria-label="Save"]'),
        page,
        'Single ARIA role target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('.mat-mdc-button-base'),
        page,
        'Single Material button class target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('.mdc-text-field'),
        page,
        'Single Material field class target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.getByTestId('hosted-payment-submit-button'),
        page,
        'Single test id button target with a descriptive caption',
      );
      const aliasedErrorMessage = page.getByText('Domain must be a single host name');
      await takeScreenshot(
        testInfo,
        [tenantCreateForm, aliasedErrorMessage],
        page,
        'Aliased single text target with a descriptive caption',
      );
      const saveButtonSurface = (page) => page.getByRole('button', { name: 'Save' });
      await takeScreenshot(
        testInfo,
        saveButtonSurface(page),
        page,
        'Helper-returned single button target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        profileSummarySurface,
        page,
        'Named surface target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [createAccountForm, submitButton],
        page,
        'Multi-target form screenshot with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.getByTestId('tenant-settings-surface'),
        page,
        'Surface test id target with a descriptive caption',
      );
    `;

    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/single-control-target.doc.ts',
        singleControlTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/single-control-target.doc.ts:2:13',
      'tests/docs/example/single-control-target.doc.ts:8:13',
      'tests/docs/example/single-control-target.doc.ts:14:13',
      'tests/docs/example/single-control-target.doc.ts:20:13',
      'tests/docs/example/single-control-target.doc.ts:26:13',
      'tests/docs/example/single-control-target.doc.ts:32:13',
      'tests/docs/example/single-control-target.doc.ts:38:13',
      'tests/docs/example/single-control-target.doc.ts:44:13',
      'tests/docs/example/single-control-target.doc.ts:50:13',
      'tests/docs/example/single-control-target.doc.ts:56:13',
      'tests/docs/example/single-control-target.doc.ts:62:13',
      'tests/docs/example/single-control-target.doc.ts:68:13',
      'tests/docs/example/single-control-target.doc.ts:75:13',
      'tests/docs/example/single-control-target.doc.ts:82:13',
    ]);
  });

  it('detects icon-only and media-only documentation screenshot targets', () => {
    const iconOrMediaTargetSource = `
      await takeScreenshot(
        testInfo,
        page.locator('svg'),
        page,
        'Single svg icon target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('img[alt="Tenant logo"]'),
        page,
        'Single image target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('fa-icon'),
        page,
        'Single Font Awesome icon target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('.mat-icon'),
        page,
        'Single Material icon target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.getByAltText('Tenant logo'),
        page,
        'Single alt text image target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.getByRole('img', { name: 'Tenant logo' }),
        page,
        'Single image role target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.getByTitle('Search icon'),
        page,
        'Single title icon target with a descriptive caption',
      );
      const tenantLogoImage = page.locator('[src="/logo.png"]');
      await takeScreenshot(
        testInfo,
        [tenantSettingsSurface, tenantLogoImage],
        page,
        'Aliased image target with a descriptive caption',
      );
      const tenantLogoSurface = (page) => page.locator('img[alt="Tenant logo"]');
      await takeScreenshot(
        testInfo,
        tenantLogoSurface(page),
        page,
        'Helper-returned image target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        tenantSettingsSurface,
        page,
        'Settings surface target with a descriptive caption',
      );
    `;

    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/icon-target.doc.ts',
        iconOrMediaTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/icon-target.doc.ts:2:13',
      'tests/docs/example/icon-target.doc.ts:8:13',
      'tests/docs/example/icon-target.doc.ts:14:13',
      'tests/docs/example/icon-target.doc.ts:20:13',
      'tests/docs/example/icon-target.doc.ts:26:13',
      'tests/docs/example/icon-target.doc.ts:32:13',
      'tests/docs/example/icon-target.doc.ts:38:13',
      'tests/docs/example/icon-target.doc.ts:45:13',
      'tests/docs/example/icon-target.doc.ts:52:13',
    ]);
  });

  it('detects screenshot target aliases and helpers declared after use', () => {
    const forwardAliasSource = `
      await takeScreenshot(
        testInfo,
        forwardAliasTarget,
        page,
        'Forward alias target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        forwardHelperTarget(page),
        page,
        'Forward helper target with a descriptive caption',
      );
      const forwardAliasTarget = page.locator('main');
      const forwardHelperTarget = (page) => page.locator('main');
    `;
    const forwardPropertyAliasSource = `
      await takeScreenshot(
        testInfo,
        forwardTargets.shell,
        page,
        'Forward property target with a descriptive caption',
      );
      const forwardTargets = {
        shell: page.locator('main'),
      };
    `;
    const wrappedForwardPropertyAliasSource = `
      await takeScreenshot(
        testInfo,
        wrappedForwardTargets.shell,
        page,
        'Wrapped forward property target with a descriptive caption',
      );
      const wrappedForwardTargets = ({
        shell: page.locator('main'),
      } as const) satisfies Record<string, unknown>;
    `;
    const forwardPropertyAssignmentSource = `
      await takeScreenshot(
        testInfo,
        assignedTargets.shell,
        page,
        'Forward property assignment target with a descriptive caption',
      );
      const assignedTargets = {};
      assignedTargets.shell = page.locator('main');
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/forward-alias-target.doc.ts',
        forwardAliasSource,
      ),
    ).toEqual([
      'tests/docs/example/forward-alias-target.doc.ts:2:13',
      'tests/docs/example/forward-alias-target.doc.ts:8:13',
    ]);
    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/forward-property-target.doc.ts',
        forwardPropertyAliasSource,
      ),
    ).toEqual(['tests/docs/example/forward-property-target.doc.ts:2:13']);
    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/wrapped-forward-property-target.doc.ts',
        wrappedForwardPropertyAliasSource,
      ),
    ).toEqual([
      'tests/docs/example/wrapped-forward-property-target.doc.ts:2:13',
    ]);
    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/forward-property-assignment.doc.ts',
        forwardPropertyAssignmentSource,
      ),
    ).toEqual(['tests/docs/example/forward-property-assignment.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/forward-alias-target.doc.ts',
        forwardAliasSource.replaceAll("locator('main')", "locator('section')"),
      ),
    ).toEqual([
      'tests/docs/example/forward-alias-target.doc.ts:2:13',
      'tests/docs/example/forward-alias-target.doc.ts:8:13',
    ]);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/forward-property-target.doc.ts',
        forwardPropertyAliasSource.replaceAll(
          "locator('main')",
          "locator('section')",
        ),
      ),
    ).toEqual(['tests/docs/example/forward-property-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/wrapped-forward-property-target.doc.ts',
        wrappedForwardPropertyAliasSource.replaceAll(
          "locator('main')",
          "locator('section')",
        ),
      ),
    ).toEqual([
      'tests/docs/example/wrapped-forward-property-target.doc.ts:2:13',
    ]);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/forward-property-assignment.doc.ts',
        forwardPropertyAssignmentSource.replaceAll(
          "locator('main')",
          "locator('section')",
        ),
      ),
    ).toEqual(['tests/docs/example/forward-property-assignment.doc.ts:2:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/forward-alias-target.doc.ts',
        forwardAliasSource.replaceAll("locator('main')", "locator('button')"),
      ),
    ).toEqual([
      'tests/docs/example/forward-alias-target.doc.ts:2:13',
      'tests/docs/example/forward-alias-target.doc.ts:8:13',
    ]);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/forward-property-target.doc.ts',
        forwardPropertyAliasSource.replaceAll(
          "locator('main')",
          "locator('button')",
        ),
      ),
    ).toEqual(['tests/docs/example/forward-property-target.doc.ts:2:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/wrapped-forward-property-target.doc.ts',
        wrappedForwardPropertyAliasSource.replaceAll(
          "locator('main')",
          "locator('button')",
        ),
      ),
    ).toEqual([
      'tests/docs/example/wrapped-forward-property-target.doc.ts:2:13',
    ]);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/forward-property-assignment.doc.ts',
        forwardPropertyAssignmentSource.replaceAll(
          "locator('main')",
          "locator('button')",
        ),
      ),
    ).toEqual(['tests/docs/example/forward-property-assignment.doc.ts:2:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/forward-alias-target.doc.ts',
        forwardAliasSource.replaceAll("locator('main')", "locator('img')"),
      ),
    ).toEqual([
      'tests/docs/example/forward-alias-target.doc.ts:2:13',
      'tests/docs/example/forward-alias-target.doc.ts:8:13',
    ]);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/forward-property-target.doc.ts',
        forwardPropertyAliasSource.replaceAll(
          "locator('main')",
          "locator('img')",
        ),
      ),
    ).toEqual(['tests/docs/example/forward-property-target.doc.ts:2:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/wrapped-forward-property-target.doc.ts',
        wrappedForwardPropertyAliasSource.replaceAll(
          "locator('main')",
          "locator('img')",
        ),
      ),
    ).toEqual([
      'tests/docs/example/wrapped-forward-property-target.doc.ts:2:13',
    ]);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/forward-property-assignment.doc.ts',
        forwardPropertyAssignmentSource.replaceAll(
          "locator('main')",
          "locator('img')",
        ),
      ),
    ).toEqual(['tests/docs/example/forward-property-assignment.doc.ts:2:13']);
  });

  it('keeps generated documentation pages explanatory and image-backed', () => {
    const documentFiles = findFiles('tests/docs')
      .filter((path) => path.endsWith('.doc.ts'))
      .toSorted();
    const expectedScreenshotCounts = new Map([
      ['tests/docs/admin/general-settings.doc.ts', 6],
      ['tests/docs/admin/global-admin.doc.ts', 6],
      ['tests/docs/events/event-approval.doc.ts', 6],
      ['tests/docs/events/event-management.doc.ts', 8],
      ['tests/docs/events/register.doc.ts', 13],
      ['tests/docs/events/unlisted-user.doc.ts', 2],
      ['tests/docs/finance/finance-overview.doc.ts', 4],
      ['tests/docs/finance/inclusive-tax-rates.doc.ts', 5],
      ['tests/docs/finance/receipt-review-reimbursement.doc.ts', 4],
      ['tests/docs/profile/discounts.doc.ts', 3],
      ['tests/docs/profile/user-profile.doc.ts', 8],
      ['tests/docs/roles/about-permissions.doc.ts', 1],
      ['tests/docs/roles/roles.doc.ts', 4],
      ['tests/docs/template-categories/categories.doc.ts', 5],
      ['tests/docs/templates/templates.doc.ts', 8],
      ['tests/docs/users/create-account.doc.ts', 4],
    ]);
    const screenshotHelper = readSource(
      'tests/support/reporters/documentation-reporter/take-screenshot.ts',
    );
    const expectedImageBackedDocuments = documentFiles;
    const screenshotCaptions = new Map<string, string[]>();

    expect(documentFiles.length).toBe(16);
    expect([...expectedScreenshotCounts.keys()].toSorted()).toEqual(
      expectedImageBackedDocuments,
    );
    expect(screenshotHelper).toContain(
      'htmlElement.style.outline = `thick solid ${highlightColor}`',
    );
    expect(screenshotHelper).toContain('htmlElement.setAttribute');
    expect(screenshotHelper).toContain("'data-docs-highlight-target'");
    expect(screenshotHelper).toContain("'data-docs-highlight-overlay'");
    expect(screenshotHelper).toContain('element.querySelectorAll');
    expect(screenshotHelper).toContain('countDocumentationHighlightPixels');
    expect(screenshotHelper).toContain('countDocumentationContentPixels');
    expect(screenshotHelper).toContain(
      'Documentation screenshots must include the highlighted focus target.',
    );
    expect(screenshotHelper).toContain(
      'Documentation screenshots must include visible page content outside the highlighted focus target.',
    );
    expect(screenshotHelper).toContain('caption: string');
    expect(screenshotHelper).toContain('caption.trim().length < 24');
    expect(screenshotHelper).toContain('captionWords.length < 4');
    expect(screenshotHelper).toContain(
      'Documentation screenshots require a descriptive caption',
    );
    expect(screenshotHelper).toContain('at least 24 characters and four words');
    expect(
      readSource('helpers/testing/generated-documentation-source.spec.ts'),
    ).toContain('singleControlCssSelectors');
    expect(screenshotHelper).toContain("testInfo.attach('image'");
    expect(screenshotHelper).toContain("testInfo.attach('image-caption'");
    expect(
      readSource('tests/specs/reporting/reporter-paths.test.ts'),
    ).toContain(
      'documentation screenshot helper highlights a visible child for zero-box hosts',
    );
    expect(
      readSource('tests/specs/reporting/reporter-paths.test.ts'),
    ).toContain(
      'documentation screenshot helper rejects captures without visible page content',
    );

    for (const path of documentFiles) {
      const source = readSource(path);
      const markdownBodies = source.match(/body:\s*`[\s\S]*?`/gu) ?? [];
      const markdownTextLength = markdownBodies
        .map((body) =>
          body
            .replaceAll('`', '')
            .replaceAll(/\$\{[\s\S]*?\}/gu, '')
            .replaceAll(/\s+/gu, ' ')
            .trim(),
        )
        .join(' ').length;

      expect(source, path).toContain("testInfo.attach('markdown'");
      expect(markdownTextLength, path).toBeGreaterThanOrEqual(120);
      expect(source, path).not.toContain('waitForTimeout(');
      expect(source, path).not.toContain('.waitForTimeout(');

      expect(source, path).toContain('takeScreenshot(');
      expect(countTakeScreenshotCalls(path, source), path).toBe(
        expectedScreenshotCounts.get(path),
      );
      expect(importsSharedScreenshotHelper(path, source), path).toBe(true);
      expect(findDirectScreenshotCalls(path, source), path).toEqual([]);
      expect(findDirectImageAttachmentCalls(path, source), path).toEqual([]);
      expect(findWeakScreenshotCaptions(path, source), path).toEqual([]);
      expect(findUnfilteredBroadScreenshotTargets(path, source), path).toEqual(
        [],
      );
      expect(findSingleControlScreenshotTargets(path, source), path).toEqual(
        [],
      );
      expect(findIconOrMediaScreenshotTargets(path, source), path).toEqual([]);
      for (const [caption, locations] of collectScreenshotCaptions(
        path,
        source,
      )) {
        screenshotCaptions.set(caption, [
          ...(screenshotCaptions.get(caption) ?? []),
          ...locations,
        ]);
      }
      expect(findGenericScreenshotTargets(path, source), path).toEqual([]);
      expect(findScreenshotHelperBypasses(path, source), path).toEqual([]);
    }

    expect(
      [...screenshotCaptions.entries()]
        .filter(([, locations]) => locations.length > 1)
        .map(
          ([caption, locations]) =>
            `${caption}: ${locations.toSorted().join(', ')}`,
        ),
    ).toEqual([]);
  });

  it('keeps product-important documentation areas represented by generated docs', () => {
    const productSource = readSource('PRODUCT.md');
    const imageBackedDocumentationAreas = [
      {
        files: ['tests/docs/events/register.doc.ts'],
        productArea: 'browsing events',
        terms: ['browse the events', 'Events list'],
      },
      {
        files: ['tests/docs/events/register.doc.ts'],
        productArea: 'registering for events',
        terms: ['Register for a free event', 'Successful registration'],
      },
      {
        files: ['tests/docs/users/create-account.doc.ts'],
        productArea: 'Registration requires an account.',
        terms: [
          'Tenant Account Creation',
          'Creating the account joins the current tenant',
        ],
      },
      {
        files: ['tests/docs/events/register.doc.ts'],
        productArea: 'manage registrations and cancellations',
        terms: [
          'Cancellation queues a registration-cancelled email',
          'Paid confirmed cancellations are still allowed',
        ],
      },
      {
        files: ['tests/docs/events/register.doc.ts'],
        productArea: 'transferring a registration',
        terms: ['Transfer an unpaid registration', 'Transfer code'],
      },
      {
        files: ['tests/docs/events/register.doc.ts'],
        productArea: 'use waitlists as lightweight demand indicators',
        terms: [
          'Full participant options expose a distinct **Join waitlist** action',
          'Leave waitlist',
        ],
      },
      {
        files: ['tests/docs/events/event-management.doc.ts'],
        productArea: 'creating an event from a template',
        terms: [
          'Create Event',
          'Templates page with reusable event template choices',
        ],
      },
      {
        files: ['tests/docs/events/event-approval.doc.ts'],
        productArea: 'submitting an event for review',
        terms: ['Submit Event for Review', 'Submit a draft for review'],
      },
      {
        files: ['tests/docs/events/event-approval.doc.ts'],
        productArea: 'publishing an event',
        terms: ['Published', 'publishes it'],
      },
      {
        files: ['tests/docs/templates/templates.doc.ts'],
        productArea: 'managing templates',
        terms: ['Creating templates', 'Saved template detail page'],
      },
      {
        files: [
          'tests/docs/admin/general-settings.doc.ts',
          'tests/docs/profile/discounts.doc.ts',
        ],
        productArea: 'ESN-card discount behavior',
        terms: [
          'ESN Card discounts',
          'Add your ESN card to receive discounted prices on eligible events.',
        ],
      },
      {
        files: [
          'tests/docs/roles/about-permissions.doc.ts',
          'tests/docs/roles/roles.doc.ts',
        ],
        productArea: 'configuring roles and capabilities',
        terms: [
          'tenant-scoped capabilities',
          'Role form with permission groups',
        ],
      },
      {
        files: ['tests/docs/events/event-management.doc.ts'],
        productArea: 'checking in participants',
        terms: [
          'Guests to check in now',
          'Scanned registration with guest check-in',
        ],
      },
      {
        files: ['tests/docs/events/event-management.doc.ts'],
        productArea: 'submitting receipts',
        terms: ['Submit receipt', 'Receipt submission dialog'],
      },
      {
        files: ['tests/docs/finance/receipt-review-reimbursement.doc.ts'],
        productArea: 'reviewing receipts',
        terms: ['Receipt approval queue', 'Receipt review detail'],
      },
      {
        files: ['tests/docs/admin/general-settings.doc.ts'],
        productArea: 'tenant branding/settings',
        terms: [
          'Brand asset upload and search preview settings',
          'General settings',
          'Upload logo',
          'Upload favicon',
        ],
      },
      {
        files: ['tests/docs/admin/general-settings.doc.ts'],
        productArea: 'legal/privacy settings',
        terms: ['Legal page fields', 'Hosted privacy policy text'],
      },
      {
        files: [
          'tests/docs/events/register.doc.ts',
          'tests/docs/finance/receipt-review-reimbursement.doc.ts',
        ],
        productArea: 'email notifications',
        terms: [
          'registration-confirmation email',
          'registration-cancelled email',
          'spot-available email',
          'transfer-completed email',
          'queues the submitter email for delivery',
        ],
      },
    ] as const;

    for (const documentationArea of imageBackedDocumentationAreas) {
      expect(productSource).toContain(`- ${documentationArea.productArea}`);

      const combinedSource = documentationArea.files
        .map((file) => readSource(file))
        .join('\n');

      for (const term of documentationArea.terms) {
        expect(combinedSource, documentationArea.productArea).toContain(term);
      }
    }
  });

  it('keeps quality documentation topics represented by generated docs', () => {
    const qualitySource = readSource('QUALITY.md');
    const generatedDocumentationTopics = [
      {
        files: [
          'tests/docs/events/event-approval.doc.ts',
          'tests/docs/events/event-management.doc.ts',
          'tests/docs/events/register.doc.ts',
          'tests/docs/events/unlisted-user.doc.ts',
        ],
        terms: ['Events', 'Published', 'Unlisted Events'],
        topic: 'events',
      },
      {
        files: ['tests/docs/templates/templates.doc.ts'],
        terms: ['Templates are the base', 'Saved template detail page'],
        topic: 'templates',
      },
      {
        files: ['tests/docs/events/register.doc.ts'],
        terms: ['Register for a free event', 'Successful registration'],
        topic: 'registrations',
      },
      {
        files: ['tests/docs/events/register.doc.ts'],
        terms: ['Stripe Checkout', 'Paid event registration options'],
        topic: 'registering for a paid event',
      },
      {
        files: ['tests/docs/events/register.doc.ts'],
        terms: [
          'Full participant options expose a distinct **Join waitlist** action',
          'Leave waitlist',
        ],
        topic: 'joining a waitlist',
      },
      {
        files: ['tests/docs/events/register.doc.ts'],
        terms: [
          'Cancellation queues a registration-cancelled email',
          'Paid confirmed cancellations are still allowed',
        ],
        topic: 'cancelling a registration',
      },
      {
        files: ['tests/docs/events/register.doc.ts'],
        terms: [
          'Transfer an unpaid registration',
          'Paid transfer and resale boundary',
        ],
        topic: 'transferring/reselling a registration',
      },
      {
        files: [
          'tests/docs/events/register.doc.ts',
          'tests/docs/finance/inclusive-tax-rates.doc.ts',
        ],
        terms: ['Stripe Checkout', 'Inclusive (VAT-style) tax rates'],
        topic: 'payments',
      },
      {
        files: ['tests/docs/events/event-management.doc.ts'],
        terms: ['Guests to check in now', 'Scanned registration'],
        topic: 'check-in',
      },
      {
        files: [
          'tests/docs/roles/about-permissions.doc.ts',
          'tests/docs/roles/roles.doc.ts',
        ],
        terms: ['About permissions', 'Role form with permission groups'],
        topic: 'roles and permissions',
      },
      {
        files: ['tests/docs/admin/general-settings.doc.ts'],
        terms: ['General settings', 'Legal page fields'],
        topic: 'tenant settings',
      },
      {
        files: [
          'tests/docs/finance/finance-overview.doc.ts',
          'tests/docs/finance/receipt-review-reimbursement.doc.ts',
        ],
        terms: ['Receipt approval queue', 'Receipt review detail'],
        topic: 'receipts',
      },
      {
        files: [
          'tests/docs/events/register.doc.ts',
          'tests/docs/finance/receipt-review-reimbursement.doc.ts',
        ],
        terms: [
          'registration-confirmation email',
          'registration-cancelled email',
          'spot-available email',
          'transfer-completed email',
          'queues the submitter email for delivery',
        ],
        topic: 'email notifications',
      },
      {
        files: ['tests/docs/roles/about-permissions.doc.ts'],
        terms: ['About permissions', 'tenant-scoped capabilities'],
        topic: 'documentation/help',
      },
    ] as const;

    for (const documentationTopic of generatedDocumentationTopics) {
      expect(qualitySource).toContain(`- ${documentationTopic.topic}`);

      const combinedSource = documentationTopic.files
        .map((file) => readSource(file))
        .join('\n');

      for (const term of documentationTopic.terms) {
        expect(combinedSource, documentationTopic.topic).toContain(term);
      }
    }
  });

  it('keeps generated documentation publishing explicit in package scripts', () => {
    const packageJson = JSON.parse(readSource('package.json')) as {
      scripts?: Record<string, string>;
    };
    const scripts = packageJson.scripts ?? {};
    const localDocumentationScripts = [
      'test:e2e:docs',
      'test:e2e:integration',
      'test:e2e:create-account',
    ];

    for (const scriptName of localDocumentationScripts) {
      const script = scripts[scriptName];

      expect(script, scriptName).toContain(
        'bun helpers/testing/run-playwright.ts',
      );
      expect(script, scriptName).not.toContain('bun run env:runtime');
      expect(script, scriptName).not.toContain('DOCS_OUT_DIR=');
      expect(script, scriptName).not.toContain('DOCS_IMG_OUT_DIR=');
      expect(script, scriptName).not.toContain(
        '/Users/hedde/code/evorto-pages',
      );
    }

    expect(readSource('helpers/testing/run-playwright.ts')).toContain(
      "DOCS_OUT_DIR: 'test-results/docs'",
    );
    expect(readSource('helpers/testing/run-playwright.ts')).toContain(
      "DOCS_IMG_OUT_DIR: 'test-results/docs/images'",
    );
    expect(readSource('helpers/testing/run-playwright.ts')).toContain(
      "spawn('bun', ['run', 'env:bootstrap']",
    );
    expect(readSource('helpers/testing/run-playwright.ts')).toContain(
      "'node_modules/.bin/playwright'",
    );

    expect(scripts['test:e2e:docs:publish']).toContain(
      'DOCS_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/src/app/docs',
    );
    expect(scripts['test:e2e:docs:publish']).toContain(
      'DOCS_IMG_OUT_DIR=/Users/hedde/code/evorto-pages/apps/documentation/public/docs',
    );
    expect(scripts['test:e2e:docs:publish']).toContain(
      'playwright test --project=docs-baseline',
    );
  });

  it('keeps tenant general-settings docs aligned with implemented branding and legal routes', () => {
    const source = readSource('tests/docs/admin/general-settings.doc.ts');

    expect(source).not.toContain(
      'domain onboarding, brand asset upload, legal text page',
    );
    expect(source).toContain(
      'A read-only **Tenant identity** summary with tenant name, primary domain, and Stripe connection state.',
    );
    expect(source).toContain('const generalSettingsSection =');
    expect(source).toContain('const generalSettingsField =');
    expect(source).toContain('const generalSettingsToggle =');
    expect(source).toContain('const generalSettingsCheckbox =');
    expect(source).toContain("locator('app-general-settings section')");
    expect(source).toContain("locator('app-general-settings mat-form-field')");
    expect(source).toContain(
      "locator('app-general-settings mat-slide-toggle')",
    );
    expect(source).toContain("locator('app-general-settings mat-checkbox')");
    expect(source).toContain("generalSettings.getByText('Domain onboarding')");
    expect(source).toContain(
      'Custom-domain verification and multi-domain automation are deferred.',
    );
    expect(source).toContain(
      "generalSettings.getByText('Primary domain', { exact: true })",
    );
    expect(source).toContain(
      "generalSettings.getByText('Stripe account', { exact: true })",
    );
    expect(source).toContain("generalSettings.getByLabel('Currency')");
    expect(source).toContain("generalSettings.getByLabel('Locale')");
    expect(source).toContain("generalSettings.getByLabel('Timezone')");
    expect(source).toContain(
      "generalSettings.getByLabel('Event review policy')",
    );
    expect(source).toContain(
      "generalSettings.getByLabel('Stripe account management')",
    );
    expect(source).toContain("generalSettings.getByLabel('Email sender name')");
    expect(source).toContain(
      "generalSettings.getByLabel('Registration limit')",
    );
    expect(source).toContain("generalSettings.getByLabel('Limit window days')");
    expect(source).toContain("generalSettings.getByLabel('Logo URL')");
    expect(source).toContain(
      "generalSettings.getByRole('button', { name: 'Upload logo' })",
    );
    expect(source).toContain(
      'input[type="file"][accept="image/png,image/jpeg,image/webp,image/gif"]',
    );
    expect(source).toContain("generalSettings.getByLabel('Favicon URL')");
    expect(source).toContain(
      "generalSettings.getByRole('button', { name: 'Upload favicon' })",
    );
    expect(source).toContain(
      'input[type="file"][accept="image/png,image/jpeg,image/webp,image/gif,image/x-icon,image/vnd.microsoft.icon"]',
    );
    expect(source).toContain("generalSettings.getByLabel('SEO title')");
    expect(source).toContain("generalSettings.getByLabel('SEO description')");
    expect(source).toContain(
      "generalSettings.getByLabel('Imprint / legal notice URL')",
    );
    expect(source).toContain(
      "generalSettings.getByLabel('Hosted imprint / legal notice text')",
    );
    expect(source).toContain(
      "generalSettings.getByLabel('Privacy policy URL')",
    );
    expect(source).toContain(
      "generalSettings.getByLabel('Hosted privacy policy text')",
    );
    expect(source).toContain("generalSettings.getByLabel('Terms URL')");
    expect(source).toContain("generalSettings.getByLabel('Hosted terms text')");
    expect(source).toContain(
      "generalSettings.getByLabel('Allowed receipt countries')",
    );
    expect(source).toContain("generalSettings.getByLabel('Allow other')");
    expect(source).toContain("generalSettings.getByText('ESN Card discounts')");
    expect(source).toContain(
      "generalSettings.getByRole('button', { name: 'Save' })",
    );
    expect(source).toContain('const deferredSettingsSummary =');
    expect(source).toContain('const tenantIdentitySummary =');
    expect(source).toContain('const operationsPolicySettingsFields =');
    expect(source).toContain('const brandAndSearchSettingsControls =');
    expect(source).toContain('const brandAndSearchSettingsSurface =');
    expect(source).toContain('const legalPageSettingsFields =');
    expect(source).toContain('const financeAndDiscountSettingsSurface =');
    expect(source).toContain('const financeAndDiscountSettingsControls =');
    expect(source).toContain(
      'await expect(deferredSettingsSummary).toBeVisible()',
    );
    expect(source).toContain(
      'await expect(tenantIdentitySummary).toBeVisible()',
    );
    expect(source).toContain(
      'for (const field of operationsPolicySettingsFields)',
    );
    expect(source).toContain(
      'for (const control of brandAndSearchSettingsControls)',
    );
    expect(source).toContain(
      'await expect(brandAndSearchSettingsSurface).toBeVisible()',
    );
    expect(source).toContain('for (const field of legalPageSettingsFields)');
    expect(source).toContain(
      'for (const control of financeAndDiscountSettingsControls)',
    );
    expect(source).toContain(
      'await expect(financeAndDiscountSettingsSurface).toBeVisible()',
    );
    expect(source).toContain(
      "generalSettingsField(page, 'Allowed receipt countries')",
    );
    expect(source).toContain("generalSettingsCheckbox(page, 'Allow other')");
    expect(source).toContain(
      "generalSettingsToggle(page, 'ESN Card discounts')",
    );
    expect(source).toContain(
      "generalSettings.getByRole('button', { name: 'Save' })",
    );
    expect(source).toContain(
      'Tenant identity summary showing primary domain and Stripe status',
    );
    expect(source).toContain(
      'Brand asset upload and search preview settings for tenant public pages',
    );
    expect(source).toContain(
      'Legal page fields for hosted imprint privacy and terms content',
    );
    expect(source).toContain(
      'Operations policy settings with participant registration limits',
    );
    expect(source).toContain(
      'takeScreenshot(\n    testInfo,\n    operationsPolicySettingsFields,',
    );
    expect(source).toContain(
      'takeScreenshot(\n    testInfo,\n    brandAndSearchSettingsSurface,',
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    emailSenderField,',
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    hostedTermsField,',
    );
    expect(source).toContain(
      'Receipt and ESN card discount settings near the save action',
    );
    expect(source).toContain(
      'takeScreenshot(\n    testInfo,\n    financeAndDiscountSettingsSurface,',
    );
    expect(source).not.toContain(
      "const esnDiscountToggle = generalSettingsToggle(page, 'ESN Card discounts');",
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    financeAndDiscountSettingsControls,',
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    esnDiscountToggle,',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    generalSettings.getByRole('heading'",
    );
    expect(source).toContain(
      'One-domain-per-tenant remains the current relaunch scope in the application schema.',
    );
    expect(source).toContain(
      'keeps an in-app deferred-settings summary for custom-domain verification and multi-domain automation',
    );
    expect(source).toContain(
      '**Currency**, **Locale**, and **Timezone** selection within the supported relaunch policy.',
    );
    expect(source).toContain(
      '**SEO title** and **SEO description** for tenant-level page metadata.',
    );
    expect(source).toContain(
      '**Email sender name** for tenant email notification display names.',
    );
    expect(source).toContain(
      '**Registration limit** and **Limit window days** for the participant registration policy',
    );
    expect(source).toContain(
      'hosted text appears at \\`/legal/imprint\\`, \\`/legal/privacy\\`, and \\`/legal/terms\\`',
    );
    expect(source).toContain(
      '**Allowed receipt countries** and **Allow other** for receipt submission.',
    );
    expect(source).toContain(
      '**ESN Card discounts** and optional **Buy ESNcard URL** when the tenant uses ESNcard validation.',
    );
    expect(source).toContain(
      'Tax rates are managed on the separate **Tax Rates** page.',
    );
    expect(source).toContain(
      'Currency, locale, and timezone changes are only accepted before event or payment data exists for the tenant.',
    );
    expect(source).toContain(
      'When one of those accepted changes is saved, Evorto reloads the app',
    );
    expect(source).not.toContain('Tax rates are configured here');
    expect(source).not.toContain(
      'Stripe account management is configured here',
    );
  });

  it('keeps global-admin docs focused on implemented relaunch tenant operations', () => {
    const inventorySource = readSource('tests/test-inventory.md');
    const globalAdminSource = readSource(
      'tests/docs/admin/global-admin.doc.ts',
    );
    const unlistedUserSource = readSource(
      'tests/docs/events/unlisted-user.doc.ts',
    );
    const documentFiles = findFiles('tests/docs');
    const generatedDocumentSources = documentFiles
      .map((path) => [path, readSource(path)] as const)
      .filter(([path]) => path.endsWith('.doc.ts'));

    expect(
      existsSync(
        nodePath.join(repositoryRoot, 'tests/docs/admin/global-admin.doc.ts'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        nodePath.join(
          repositoryRoot,
          'tests/docs/events/unlisted-admin.doc.ts',
        ),
      ),
    ).toBe(false);
    expect(inventorySource).toContain('docs/admin/global-admin.doc.ts');
    expect(inventorySource).not.toContain('docs/events/unlisted-admin.doc.ts');
    expect(globalAdminSource).toContain(
      "test('Global admin: manage tenants @admin @globalAdmin'",
    );
    expect(globalAdminSource).toContain('# Global Tenant Administration');
    expect(globalAdminSource).toContain(
      'Global tenant list with search and tenant operational summary rows',
    );
    expect(globalAdminSource).toContain('const tenantSummaryCard =');
    expect(globalAdminSource).toContain('filter({ hasText: tenantDomain })');
    expect(globalAdminSource).toContain("filter({ hasText: 'Review tenant' })");
    expect(globalAdminSource).toContain(
      'Empty tenant search result explaining no matching tenants were found',
    );
    expect(globalAdminSource).toContain('const tenantSearchEmptyState =');
    expect(globalAdminSource).toContain(
      "filter({ hasText: 'No tenants match this search' })",
    );
    expect(globalAdminSource).toContain(
      'Create tenant form showing the relaunch tenant scope boundaries',
    );
    expect(globalAdminSource).toContain('const tenantScopeCard =');
    expect(globalAdminSource).toContain("locator('form > aside')");
    expect(globalAdminSource).toContain(
      'Create tenant form preserving URL-shaped domain input after rejection',
    );
    expect(globalAdminSource).toContain('const tenantCreateForm =');
    expect(globalAdminSource).toContain("filter({ hasText: 'Tenant name' })");
    expect(globalAdminSource).toContain(
      "filter({ hasText: 'Primary domain' })",
    );
    expect(globalAdminSource).toContain("filter({ hasText: 'Timezone' })");
    expect(globalAdminSource).toContain("filter({ hasText: 'Create tenant' })");
    expect(globalAdminSource).toContain(
      'const rejectedDomainForm = tenantCreateForm(tenantCreate);',
    );
    expect(globalAdminSource).toContain(
      'takeScreenshot(\n    testInfo,\n    rejectedDomainForm,',
    );
    expect(globalAdminSource).not.toContain(
      'const rejectedDomainMessage = page.getByText(',
    );
    expect(globalAdminSource).not.toContain(
      '[rejectedDomainForm, rejectedDomainMessage]',
    );
    expect(globalAdminSource).not.toContain(
      "takeScreenshot(\n    testInfo,\n    tenantCreate.getByLabel('Primary domain'),",
    );
    expect(globalAdminSource).toContain(
      'Tenant detail review with read-only operational fields and actions',
    );
    expect(globalAdminSource).toContain('const tenantDetailReviewCard =');
    expect(globalAdminSource).toContain(
      "filter({ hasText: 'Open tenant domain' })",
    );
    expect(globalAdminSource).toContain(
      'Edit tenant form with relaunch-scoped tenant settings ready to save',
    );
    expect(globalAdminSource).toContain('const tenantEditForm =');
    expect(globalAdminSource).toContain("locator('form')");
    expect(globalAdminSource).toContain("filter({ hasText: 'Tenant name' })");
    expect(globalAdminSource).toContain(
      "filter({ hasText: 'Primary domain' })",
    );
    expect(globalAdminSource).toContain(
      "filter({ hasText: 'Relaunch tenant scope' })",
    );
    expect(globalAdminSource).toContain("filter({ hasText: 'Save tenant' })");
    expect(globalAdminSource).not.toContain(
      "const tenantEditForm = (tenantEdit: Locator) =>\n  tenantEdit.locator('form').first();",
    );
    expect(globalAdminSource).not.toContain(
      "takeScreenshot(\n    testInfo,\n    tenantList.getByRole('heading'",
    );
    expect(globalAdminSource).not.toContain(
      "takeScreenshot(\n    testInfo,\n    tenantCreate.getByRole('heading'",
    );
    expect(globalAdminSource).not.toContain(
      "takeScreenshot(\n    testInfo,\n    tenantDetail.getByRole('heading'",
    );
    expect(globalAdminSource).not.toContain(
      "takeScreenshot(\n    testInfo,\n    tenantEdit.getByRole('heading'",
    );
    expect(globalAdminSource).toContain('/global-admin/tenants');
    expect(globalAdminSource).toContain('Relaunch tenant scope');
    expect(globalAdminSource).toContain(
      'One active primary domain is managed here.',
    );
    expect(globalAdminSource).toContain(
      'Custom-domain verification and multi-domain automation are deferred.',
    );
    expect(globalAdminSource).toContain(
      'Tenant-admin impersonation is not available in the current relaunch surface.',
    );
    expect(globalAdminSource).not.toMatch(
      /custom.?domain verification is implemented/i,
    );
    expect(globalAdminSource).not.toMatch(/multiple domains? can be managed/i);
    expect(globalAdminSource).not.toMatch(/impersonat(?:e|ion) tenant/i);
    expect(unlistedUserSource).toContain(
      "test('User: understanding unlisted events'",
    );
    expect(unlistedUserSource).toContain('# Unlisted Events (User)');
    expect(unlistedUserSource).toContain(
      'Expected an upcoming approved listed event in the seeded events',
    );
    expect(unlistedUserSource).toContain(
      'Expected a second upcoming approved listed event for unlisted docs list context',
    );
    expect(unlistedUserSource).toContain(
      'const findUpcomingApprovedListedEvents =',
    );
    expect(unlistedUserSource).toContain(
      'event.start.getTime() > listClock.getTime()',
    );
    expect(unlistedUserSource).toContain(
      '.toSorted((left, right) => left.start.getTime() - right.start.getTime())',
    );
    expect(unlistedUserSource).toContain(
      'const [event, listedContextEvent] = findUpcomingApprovedListedEvents',
    );
    expect(unlistedUserSource).toContain('const visibleListedEventLink =');
    expect(unlistedUserSource).toContain("locator('app-event-list nav a')");
    expect(unlistedUserSource).toContain(
      "has: page.getByRole('heading', { level: 2, name: eventTitle })",
    );
    expect(unlistedUserSource).toContain(
      'Visible listed event card while the unlisted event is hidden from the event list',
    );
    expect(unlistedUserSource).toContain('set({ unlisted: true })');
    expect(unlistedUserSource).not.toContain(
      "page.locator('app-event-list nav a').first()",
    );
    expect(unlistedUserSource).not.toContain(
      'User-facing events list with visible events while unlisted event stays hidden',
    );
    expect(unlistedUserSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-event-list nav').first(),",
    );
    expect(unlistedUserSource).toContain('eventRegistrationSection');
    expect(unlistedUserSource).toContain(
      "page.getByRole('heading', { level: 2, name: 'Registration' })",
    );
    expect(unlistedUserSource).toContain(
      'const eventRegistrationOptionSurface =',
    );
    expect(unlistedUserSource).toContain(
      "locator('app-event-registration-option')",
    );
    expect(unlistedUserSource).toContain(
      "has: page.getByRole('heading', { name: input.optionTitle })",
    );
    expect(unlistedUserSource).toContain(
      'eq(schema.eventRegistrationOptions.organizingRegistration, false)',
    );
    expect(unlistedUserSource).toContain(
      'Expected unlisted docs event "${event.title}" to have a visible participant registration option',
    );
    expect(unlistedUserSource).toContain(
      'const registrationOption = eventRegistrationOptionSurface(page',
    );
    expect(unlistedUserSource).toContain(
      'testInfo,\n      registrationOption,',
    );
    expect(unlistedUserSource).not.toContain(
      "registrationSection.locator('app-event-registration-option').first()",
    );
    expect(unlistedUserSource).toContain(
      'Direct link opens the unlisted event registration details',
    );
    expect(unlistedUserSource).toContain('set({ unlisted: event.unlisted })');
    expect(unlistedUserSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('heading', { name: event.title }),\n      page,\n      'Direct link opens the unlisted event detail page'",
    );
    expect(unlistedUserSource).not.toMatch(/admin|global-admin|global admin/i);
    expect(documentFiles).toEqual(
      expect.arrayContaining(['tests/docs/admin/global-admin.doc.ts']),
    );
    for (const [path, source] of generatedDocumentSources) {
      if (path !== 'tests/docs/admin/global-admin.doc.ts') {
        expect(source, path).not.toContain('/global-admin');
        expect(source, path).not.toMatch(/global-admin|global admin/i);
      }
    }
  });

  it('keeps profile docs aligned with implemented account and event-card behavior', () => {
    const source = readSource('tests/docs/profile/user-profile.doc.ts');

    expect(source).toContain(
      'Login email address and notification email address',
    );
    expect(source).toContain(
      'IBAN and PayPal details are optional global reimbursement details, not tenant-specific payout instructions.',
    );
    expect(source).toContain(
      'The notification email is user-managed and may differ from the Auth0 login email.',
    );
    expect(source).toContain(
      'Optional IBAN and PayPal fields store global reimbursement details for finance teams.',
    );
    expect(source).toContain('documentedIban');
    expect(source).toContain('documentedPaypalEmail');
    expect(source).toContain("getByRole('textbox', { name: 'IBAN' })");
    expect(source).toContain("getByRole('textbox', { name: 'PayPal email' })");
    expect(source).toContain('updatedProfileUser.iban).toBe(documentedIban)');
    expect(source).toContain(
      'updatedProfileUser.paypalEmail).toBe(documentedPaypalEmail)',
    );
    expect(source).toContain(
      'Profile event cards point pending checkout registrations at the implemented profile action, route ticket/cancellation/unpaid-transfer details back to the event page, expose waitlist routing back to the event page, and stop advertising cancellation or transfer once a registration is checked in',
    );
    expect(source).toContain(
      'Continue payment from this card, or open the event page for registration details.',
    );
    expect(source).toContain(
      'Open the event page for waitlist details and the leave-waitlist action.',
    );
    expect(source).toContain(
      '`/events/${profileEventCards.confirmed.eventId}`',
    );
    expect(source).toContain(
      '`/events/${profileEventCards.pendingCheckout.eventId}`',
    );
    expect(source).toContain('`/events/${profileEventCards.waitlist.eventId}`');
    expect(source).toContain(
      '`/events/${profileEventCards.checkedIn.eventId}`',
    );
    expect(source).toContain("getByRole('link', { name: 'Continue payment' })");
    expect(source).toContain('pendingCheckoutRegistration');
    expect(source).toContain('checkedInAddonPurchase');
    expect(source).toContain('const profileSummarySurface =');
    expect(source).toContain("locator('app-user-profile section')");
    expect(source).toContain("button', { name: 'Edit profile' })");
    expect(source).toContain('const profileNavigationSurface =');
    expect(source).toContain("locator('.navigation')");
    expect(source).toContain(
      "has: page.getByRole('link', { name: 'Profile' })",
    );
    expect(source).toContain('const profileEditDialogSurface =');
    expect(source).toContain("locator('mat-dialog-container')");
    expect(source).toContain(
      "has: page.getByRole('heading', { name: 'Edit profile' })",
    );
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'First name' })",
    );
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'Last name' })",
    );
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'Notification email' })",
    );
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'IBAN' })",
    );
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'PayPal email' })",
    );
    expect(source).toContain("has: page.getByRole('button', { name: 'Save' })");
    expect(source).toContain(
      'User profile overview with section navigation and personal details',
    );
    expect(source).toContain('[profileNavigation, profileSummary]');
    expect(source).toContain('const profileEventCardSurface =');
    expect(source).toContain('filter({ hasText: eventTitle })');
    expect(source).toContain('hasText: addOnTitle');
    expect(source).toContain('const profileEventsSectionSurface =');
    expect(source).toContain(
      "has: page.getByRole('heading', { name: 'Your Event Registrations' })",
    );
    expect(source).toContain('const profileReceiptCardSurface =');
    expect(source).toContain('filter({ hasText: receiptFileName })');
    expect(source).toContain(
      'You are checked in. Open the event page for ticket details. Cancellation and transfer are no longer available after check-in.',
    );
    expect(source).toContain('Submitted receipts');
    expect(source).toContain('profile-docs-receipt-');
    expect(source).toContain('schema.financeReceipts');
    expect(source).toContain('profileReceiptCard.getByText');
    expect(source).toContain('profileReceiptFileName');
    expect(source).toContain('Submitted');
    expect(source).toContain('profileEvent.title');
    expect(source).toContain('18.75 €');
    expect(source).toContain(
      'Profile events tab showing confirmed, pending, waitlist, and checked-in registrations',
    );
    expect(source).toContain('[\n        profileEventsSectionSurface(page),');
    expect(source).toContain(
      'documentedEventCard,\n        pendingCheckoutCard',
    );
    expect(source).toContain('waitlistCard,\n        checkedInEventCard');
    expect(source).toContain(
      'Expected generated profile docs user after update',
    );
    expect(source).toContain('updatedProfileUser.communicationEmail).toBe');
    expect(source).toContain(
      'Expected generated profile docs receipt after read',
    );
    expect(source).toContain('attachmentFileName: profileReceiptFileName');
    expect(source).toContain('totalAmount: 1875');
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-user-profile'),\n      page,\n      'Profile events tab showing the user registration history'",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      documentedEventCard,\n      page,\n      'Profile events tab showing the user registration history'",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-user-profile'),\n      page,\n      'Profile receipts tab showing submitted reimbursement receipts'",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-user-profile'),\n      page,\n      'User profile page showing personal details and profile tabs'",
    );
    expect(source).not.toContain(
      "const editDialog = page.locator('mat-dialog-container');",
    );
    expect(source).not.toContain('automatic refund');
    expect(source).not.toContain('resale');
    expect(source).not.toContain('ticket email');
  });

  it('keeps account-creation docs aligned with notification-email and retry semantics', () => {
    const source = readSource('tests/docs/users/create-account.doc.ts');

    expect(source).toContain(
      'The account form pre-fills first name, last name, and **Notification email** from Auth0 data when available.',
    );
    expect(source).toContain(
      'It stays disabled while invalid, already submitting, or waiting for the account-creation mutation',
    );
    expect(source).toContain(
      'Existing global users with the same Auth0 id join the current tenant instead of creating a duplicate global user.',
    );
    expect(source).toContain(
      "Evorto has attached your global login to this tenant, granted the tenant's default roles, and set this tenant as your home tenant for future tenant-mismatch warnings.",
    );
    expect(source).toContain(
      'Profile page after tenant account creation succeeds',
    );
    expect(source).toContain('createAccountLoginSurface');
    expect(source).toContain("locator('app-navigation')");
    expect(source).toContain(
      "filter({ has: page.getByRole('link', { name: 'Events' }) })",
    );
    expect(source).toContain(
      "filter({ has: page.getByRole('link', { name: 'Login' }) })",
    );
    expect(source).toContain('const loginSurface =');
    expect(source).toContain(
      'Application navigation showing the login entry point',
    );
    expect(source).toContain('auth0LoginFormSurface');
    expect(source).toContain("locator('form')");
    expect(source).toContain(
      "filter({ has: page.getByLabel('Email address') })",
    );
    expect(source).toContain(
      "filter({ has: page.getByRole('textbox', { name: 'Password' }) })",
    );
    expect(source).toContain(
      "has: page.getByRole('button', { exact: true, name: 'Continue' })",
    );
    expect(source).toContain('const auth0LoginForm =');
    expect(source).toContain(
      'Auth0 login form requesting the tenant account email address',
    );
    expect(source).toContain('createAccountFormSurface');
    expect(source).toContain("locator('app-create-account form')");
    expect(source).toContain(
      "has: page.getByRole('textbox', { name: 'Notification email' })",
    );
    expect(source).toContain(
      "has: page.getByRole('button', { exact: true, name: 'Create Account' })",
    );
    expect(source).toContain('createdProfileSummarySurface');
    expect(source).toContain("locator('app-user-profile section')");
    expect(source).toContain('filter({ hasText: input.fullName })');
    expect(source).toContain('filter({ hasText: input.notificationEmail })');
    expect(source).toContain("filter({ hasText: 'Edit profile' })");
    expect(source).toContain('homeTenantId: tenant.id');
    expect(source).toContain(
      'Expected account creation docs to join current tenant',
    );
    expect(source).toContain('roleAssignments.length).toBeGreaterThan(0)');
    expect(source).toContain(
      'If account creation fails, the page shows a retryable server error instead of silently losing the submit attempt.',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('heading', {\n        level: 1,\n        name: `${newUser.firstName} ${newUser.lastName}`,\n      }),\n      page,\n      'Profile page after tenant account creation succeeds'",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('link', { name: 'Login' }),",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByLabel('Email address'),",
    );
    expect(source).not.toContain(
      "const createAccountForm = page\n      .locator('form')\n      .filter({ has: createAccountButton })\n      .first();",
    );
    expect(source).not.toContain('login email as your notification email');
    expect(source).not.toContain('tenant-specific notification email');
  });

  it('keeps finance receipt docs aligned with queued notification and manual reimbursement scope', () => {
    const overviewSource = readSource(
      'tests/docs/finance/finance-overview.doc.ts',
    );
    const receiptSource = readSource(
      'tests/docs/finance/receipt-review-reimbursement.doc.ts',
    );
    const combinedSource = `${overviewSource}\n${receiptSource}`;

    expect(combinedSource).toContain(
      'queues the submitter email notification for delivery',
    );
    expect(combinedSource).toContain('queues a submitter email after saving');
    expect(combinedSource).toContain(
      'Recording a reimbursement creates the Evorto finance transaction only.',
    );
    expect(combinedSource).toContain(
      'Transfer the money manually through the selected payout method.',
    );
    expect(combinedSource).toContain(
      'actual money movement remains a manual finance operation',
    );
    expect(combinedSource).toContain('queues the submitter email for delivery');
    expect(receiptSource).toContain(
      'Expected generated receipt review docs receipt',
    );
    expect(receiptSource).toContain(
      "page.getByRole('link', { name: receiptFileName })",
    );
    expect(receiptSource).toContain('const approvalQueueReceiptSurface =');
    expect(receiptSource).toContain(
      "locator('app-receipt-approval-list section')",
    );
    expect(receiptSource).toContain('const receiptReviewDecisionSurface =');
    expect(receiptSource).toContain(
      "locator('app-receipt-approval-detail section')",
    );
    expect(receiptSource).toContain(
      "has: page.getByRole('heading', { name: 'Receipt data' })",
    );
    expect(receiptSource).toContain('return approvedReceipt?.status');
    expect(receiptSource).toContain('filter({ hasText: receiptFileName })');
    expect(receiptSource).toContain(
      'const recordedReimbursementStateSurface =',
    );
    expect(receiptSource).toContain(
      "filter({ has: page.getByText('Selected total: 0.00 €') })",
    );
    expect(receiptSource).toContain(
      'Receipt reimbursement page after recording the manual transaction',
    );
    expect(receiptSource).toContain('refundTransactionId: expect.any(String)');
    expect(receiptSource).toContain("status: 'refunded'");
    expect(receiptSource).toContain('.delete(schema.transactions)');
    expect(combinedSource).not.toContain('sends an automatic submitter email');
    expect(combinedSource).not.toContain('automatic email');
    expect(combinedSource).not.toContain('automatically transfer');
    expect(combinedSource).not.toContain('automatic money movement');
    expect(receiptSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-receipt-approval-list'),",
    );
    expect(receiptSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-receipt-approval-detail'),",
    );
    expect(receiptSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-receipt-refund-list'),",
    );
  });

  it('keeps inclusive tax-rate docs focused on seeded compatible rows and paid option controls', () => {
    const source = readSource('tests/docs/finance/inclusive-tax-rates.doc.ts');

    expect(source).toContain('taxRateSection');
    expect(source).toContain('taxRateRow');
    expect(source).toContain('importStripeTaxRatesDialogSurface');
    expect(source).toContain('eventPaidRegistrationOptionForm');
    expect(source).toContain('Compatible Tax Rates');
    expect(source).toContain('txr_1S6a7sPPcz51fqyK4AVB8NSS');
    expect(source).toContain('txr_1S6a8LPPcz51fqyK4CPonBgy');
    expect(source).toContain(
      'Compatible inclusive tax-rate rows available for paid registrations',
    );
    expect(source).toContain(
      'Import Stripe tax rates dialog with compatible imported VAT rows',
    );
    expect(source).toContain("importDialog.locator('mat-checkbox').first()");
    expect(source).toContain("importDialog.getByText('included').first()");
    expect(source).toContain("importDialog.getByText('imported').first()");
    expect(source).toContain(
      'Event edit paid registration option tax-rate controls',
    );
    expect(source).toContain('Inclusive tax; shown price is final');
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('mat-dialog-container'),",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-tax-rates-settings'),\n      page,\n      'Tax rates overview showing inclusive rate management'",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      eventEditTax.first(),\n      page,\n      'Event edit tax rate selector'",
    );
  });

  it('keeps finance overview docs aligned with permission-scoped navigation', () => {
    const source = readSource('tests/docs/finance/finance-overview.doc.ts');

    expect(source).toContain(
      'Each child page is guarded by its own finance permission.',
    );
    expect(source).toContain('The finance overview is a navigation surface.');
    expect(source).toContain(
      'It shows links only for the finance capabilities you have, so users with receipt approval access do not automatically see the transaction list.',
    );
    expect(source).toContain(
      '- **finance:viewTransactions**: view the tenant transaction list.',
    );
    expect(source).toContain(
      '- **finance:approveReceipts**: review submitted receipts.',
    );
    expect(source).toContain(
      '- **finance:refundReceipts**: record receipt reimbursement batches.',
    );
    expect(source).toContain('visibleTransactionComment');
    expect(source).toContain('cancelledTransactionComment');
    expect(source).toContain('submittedReceiptFileName');
    expect(source).toContain('approvedReceiptFileName');
    expect(source).toContain('const financeOverviewNavigationSurface =');
    expect(source).toContain("locator('app-finance-overview nav')");
    expect(source).toContain(
      "filter({ has: page.getByRole('link', { name: 'Transactions' }) })",
    );
    expect(source).toContain(
      "filter({ has: page.getByRole('link', { name: 'Receipt approvals' }) })",
    );
    expect(source).toContain(
      "has: page.getByRole('link', { name: 'Receipt reimbursements' })",
    );
    expect(source).toContain('const financeOverviewNavigationCard =');
    expect(source).toContain("locator('app-finance-overview nav a')");
    expect(source).toContain('const financeNavigation =');
    expect(source).toContain('const transactionRow =');
    expect(source).toContain(
      "page.getByRole('row').filter({ hasText: comment })",
    );
    expect(source).toContain('const receiptApprovalRow =');
    expect(source).toContain("locator('app-receipt-approval-list a')");
    expect(source).toContain('const receiptReimbursementRow =');
    expect(source).toContain('const transactionNavigationCard =');
    expect(source).toContain('const visibleTransactionRow =');
    expect(source).toContain('const submittedReceiptRow =');
    expect(source).toContain('const approvedReceiptRow =');
    expect(source).toContain(
      'Cancelled transactions are omitted from this list.',
    );
    expect(source).toContain(
      'page.getByText(cancelledTransactionComment)).toHaveCount(0)',
    );
    expect(source).toContain(
      'page.getByText(submittedReceiptFileName)).toBeVisible()',
    );
    expect(source).toContain(
      'page.getByText(approvedReceiptFileName)).toBeVisible()',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-finance-overview')",
    );
    expect(source).not.toContain(
      'takeScreenshot(\n      testInfo,\n      transactionNavigationCard,',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-transaction-list')",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-receipt-approval-list')",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-receipt-refund-list')",
    );
    expect(source).not.toContain('all finance users see all finance pages');
    expect(source).not.toContain(
      'receipt approval access includes transactions',
    );
    expect(source).not.toContain('single finance permission');
  });

  it('keeps template docs aligned with the simple-mode relaunch surface', () => {
    const source = readSource('tests/docs/templates/templates.doc.ts');
    const formSource = readSource(
      'src/app/templates/shared/template-form/template-form.utilities.ts',
    );
    const organizerDefaultTitle = formSource.match(
      /organizerRegistration:\s*createTemplateRegistrationFormModel\(\{[\s\S]*?title:\s*'([^']+)'/u,
    )?.[1];
    const participantDefaultTitle = formSource.match(
      /participantRegistration:\s*createTemplateRegistrationFormModel\(\{[\s\S]*?title:\s*'([^']+)'/u,
    )?.[1];

    expect(organizerDefaultTitle).toBe('Organizer Registration');
    expect(participantDefaultTitle).toBe('Participant Registration');

    expect(source).toContain(
      'Simple mode intentionally keeps exactly one organizer registration block and one participant registration block.',
    );
    expect(source).toContain(
      'Use reusable add-ons, registration questions, option descriptions, role eligibility, and organizer planning tips to capture repeatable event knowledge',
    );
    expect(source).toContain(
      '**Description** and **description for registered users**: Optional reusable',
    );
    expect(source).toContain(
      '**ESNcard discounted price**: Optional discounted pricing for tenants with the ESNcard discount provider enabled.',
    );
    expect(source).toContain(
      '**Selected roles**: The roles that are selected for this registration.',
    );
    expect(source).toContain(
      'Role selection also avoids duplicate entries by hiding already selected roles from the autocomplete list.',
    );
    expect(source).toContain(
      "throw new Error('Expected template docs autocomplete option to have text')",
    );
    expect(source).toContain(
      'Organizer planning tips**: Optional private organizer notes',
    );
    expect(source).toContain(
      'When **Enable Payment** is on, the price and tax-rate fields appear for that registration block.',
    );
    expect(source).toContain(
      'Add-ons can be free or paid, attached to either the participant or organizer registration option',
    );
    expect(source).toContain(
      'standalone before-event and during-event add-on sales are handled separately from this template setup flow',
    );
    expect(source).toContain(
      'Questions can include help text and can be marked as required.',
    );
    expect(source).toContain(
      'Event-side answer collection is handled separately from this template setup flow.',
    );
    expect(source).toContain('fillTemplateBasics');
    expect(source).toContain('createdTemplate.planningTips');
    expect(source).toContain('const savedTemplateDetailSurface =');
    expect(source).toContain('const templateOverviewSurface =');
    expect(source).toContain('const templateGeneralSettingsSurface =');
    expect(source).toContain('const simpleRegistrationSetupSurface =');
    expect(source).toContain('const templateAddOnFormSurface =');
    expect(source).toContain('const templateQuestionFormSurface =');
    expect(source).toContain("locator('app-template-list nav')");
    expect(source).toContain(
      "filter({ has: page.getByRole('link', { name: 'Create template' }) })",
    );
    expect(source).toContain('filter({ hasText: input.categoryTitle })');
    expect(source).toContain('const templateOverview =');
    expect(source).toContain(
      'Templates overview with seeded categories and create-template action',
    );
    expect(source).toContain("locator('app-template-general-form')");
    expect(source).toContain("locator('app-template-create form > div')");
    expect(source).toContain(
      "filter({ has: page.getByLabel('Template title') })",
    );
    expect(source).toContain(
      "filter({ has: page.getByLabel('Template Category') })",
    );
    expect(source).toContain(
      "filter({ has: page.getByLabel('Organizer planning tips') })",
    );
    expect(source).toContain('const generalSettingsForm =');
    expect(source).toContain('await expect(generalSettingsForm).toBeVisible()');
    expect(source).toContain('const simpleRegistrationSetup =');
    expect(source).toContain(
      "simpleRegistrationSetup.locator('app-template-registration-option-form')",
    );
    expect(source).toContain(').toHaveCount(2)');
    expect(source).toContain(
      "simpleRegistrationSetup.getByLabel('Registration option name')",
    );
    expect(source).toContain(`).toHaveValue('${organizerDefaultTitle}')`);
    expect(source).toContain(`).toHaveValue('${participantDefaultTitle}')`);
    expect(source).toContain(
      'Simple registration setup with organizer and participant defaults',
    );
    expect(source).toContain("locator('app-template-addon-form')");
    expect(source).toContain("filter({ has: page.getByLabel('Add-on name') })");
    expect(source).toContain("filter({ has: page.getByLabel('Attach to') })");
    expect(source).toContain("filter({ hasText: 'Purchase timing' })");
    expect(source).toContain(
      'const addOnForm = templateAddOnFormSurface(page)',
    );
    expect(source).toContain("locator('app-template-question-form')");
    expect(source).toContain(
      "filter({ has: page.getByRole('textbox', { name: 'Question' }) })",
    );
    expect(source).toContain("filter({ has: page.getByLabel('Ask during') })");
    expect(source).toContain("filter({ hasText: 'Require an answer' })");
    expect(source).toContain(
      'const questionForm = templateQuestionFormSurface(page)',
    );
    expect(source).toContain("locator('app-template-details section')");
    expect(source).toContain('filter({ hasText: input.planningTips })');
    expect(source).toContain('filter({ hasText: input.addOnTitle })');
    expect(source).toContain('filter({ hasText: input.questionTitle })');
    expect(source).toContain('await expect(savedTemplateDetail).toBeVisible()');
    expect(source).toContain(
      'Saved template detail page with planning tips add-on and question',
    );
    expect(source).toContain('addonToTemplateRegistrationOptions');
    expect(source).toContain('templateRegistrationQuestions.findFirst');
    expect(source).toContain(
      'Expected template docs flow to persist the reusable add-on',
    );
    expect(source).not.toContain('bulk registration options');
    expect(source).not.toContain('multiple participant registration blocks');
    expect(source).not.toContain('public event planning tips');
    expect(source).not.toContain('roles can be selected more than once');
    expect(source).not.toContain(
      'ESNcard pricing is configured on events only',
    );
    expect(source).not.toContain('standalone add-on sales are configured here');
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('heading', { name: templateTitle })",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('link', { name: 'Create template' }),",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.locator('app-template-create form div').first(),",
    );
    expect(source).not.toContain(
      "const addOnForm = page.locator('app-template-addon-form').first();",
    );
    expect(source).not.toContain(
      "const questionForm = page.locator('app-template-question-form').first();",
    );
    expect(source).not.toContain(
      ".locator('div', { hasText: 'Simple Registration Setup' })",
    );
  });

  it('keeps template category docs backed by deterministic persistence checks', () => {
    const source = readSource(
      'tests/docs/template-categories/categories.doc.ts',
    );

    expect(source).toContain('Category docs ${seedDate.getTime()}');
    expect(source).toContain('const categoryManagerSurface =');
    expect(source).toContain("locator('app-category-list')");
    expect(source).toContain(
      "has: page.getByRole('heading', { name: 'Template Categories' })",
    );
    expect(source).toContain(
      "filter({ has: page.getByRole('button', { name: 'Create category' }) })",
    );
    expect(source).toContain("filter({ has: page.getByRole('table') })");
    expect(source).toContain('const categoryManager = categoryManagerSurface');
    expect(source).toContain(
      'Template category manager with the create-category action highlighted',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('button', { name: 'Create category' }),",
    );
    expect(source).toContain('categoryDialogSurface');
    expect(source).toContain(".locator('mat-dialog-container')");
    expect(source).toContain(
      "filter({ has: page.getByRole('heading', { name: title }) })",
    );
    expect(source).toContain(
      "filter({ has: page.getByRole('textbox', { name: 'Category title' }) })",
    );
    expect(source).toContain(
      "filter({ has: page.getByRole('button', { name: 'Save' }) })",
    );
    expect(source).toContain("'Create a new category'");
    expect(source).toContain("'Edit category'");
    expect(source).toContain(
      'Template category create dialog with title and save action',
    );
    expect(source).toContain('New template category row after saving');
    expect(source).toContain(
      'Template category edit dialog with existing title and save action',
    );
    expect(source).toContain('Updated template category row after renaming');
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('textbox', { name: 'Category title' }),",
    );
    expect(source).not.toContain(
      "const categoryDialogForm = (page: Page): Locator =>\n  page.locator('mat-dialog-container form').first();",
    );
    expect(source).toContain(
      'Expected generated category docs to persist the category',
    );
    expect(source).toContain(
      'Expected generated category docs to update the category',
    );
    expect(source).toContain(
      'updatedCategory.title).toBe(updatedCategoryTitle)',
    );
    expect(source).toContain('.delete(schema.eventTemplateCategories)');
    expect(source).not.toContain("fill('Test category')");
    expect(source).not.toContain('Test category edited');
  });

  it('keeps registration docs aligned with unavailable states and transfer scope', () => {
    const source = readSource('tests/docs/events/register.doc.ts');

    expect(source).toContain(
      'When a participant option is full, registration changes to a distinct **Join waitlist** action',
    );
    expect(source).toContain(
      'Waitlisted participants can return to the event page and use **Leave waitlist** before the event starts.',
    );
    expect(source).toContain(
      'When the registration window is closed, participants can still read the event details, but the registration action is removed.',
    );
    expect(source).toContain(
      'This event is visible from the direct link, but your account is not eligible for the available registration options.',
    );
    expect(source).toContain(
      'Confirmed unpaid registrations can be transferred from the event page before check-in and before the event starts.',
    );
    expect(source).toContain(
      'Paid registration transfer or direct resale now starts with a transfer link/code. The replacement participant can start a Stripe Checkout registration from the link; after checkout succeeds, Evorto cancels the original registration and handles the source refund path. Public resale listings are outside the relaunch scope.',
    );
    expect(source).toContain('Review paid transfer/direct-resale state');
    expect(source).toContain(
      'Create a 24-hour transfer link and code for this paid registration. Share it with the replacement participant for direct transfer or resale; after replacement checkout succeeds, Evorto cancels this registration and handles the source refund path.',
    );
    expect(source).toContain(
      "page.getByRole('button', { name: 'Create transfer link' })",
    );
    expect(source).toContain(
      "page.getByRole('button', { name: 'Transfer registration' })",
    );
    expect(source).toContain(
      'Expected registration docs paid transfer state to persist the registration',
    );
    expect(source).toContain('Paid transfer code');
    expect(source).toContain(
      'QR email delivery is not part of the current relaunch flow.',
    );
    expect(source).toContain(
      'Evorto queues a registration-confirmation email to your notification email address.',
    );
    expect(source).toContain(
      'The email tells you to open Evorto for the ticket and event details; it does not send the QR code directly.',
    );
    expect(source).toContain('freeConfirmedRegistrationCard');
    expect(source).toContain('paidConfirmedRegistrationCard');
    expect(source).toContain(
      "getByAltText(\n        'QR code for the registration'",
    );
    expect(source).toContain(
      "freeConfirmedRegistrationCard.getByText('2 x Snack voucher')",
    );
    expect(source).toContain(
      'Cancellation queues a registration-cancelled email to your notification email address.',
    );
    expect(source).toContain('seedRequiredRegistrationQuestion');
    expect(source).toContain(
      'Free registration cards can also offer registration-time add-ons and required questions.',
    );
    expect(source).toContain(
      'Question answers are stored with the registration for organizers.',
    );
    expect(source).toContain(
      'participantRegistrationCard.getByLabel(registrationQuestion.title)',
    );
    expect(source).toContain('replayCheckoutCompletedWebhook');
    expect(source).toContain(
      'Timed out waiting for replayed Stripe checkout webhook to be mirrored in the application database',
    );
    expect(source).toContain('const stripeCheckoutFormSurface =');
    expect(source).toContain(".locator('form')");
    expect(source).toContain("has: page.getByRole('button'");
    expect(source).toContain(
      'const checkoutForm = stripeCheckoutFormSurface(checkoutPage);',
    );
    expect(source).not.toContain(
      "const checkoutForm = checkoutPage.locator('form').first();",
    );
    expect(source).not.toContain("getByTestId('hosted-payment-submit-button')");
    expect(source).toContain('registration.questionAnswers');
    expect(source).toContain(
      'If that option asks required registration questions, participants must answer them before joining the waitlist.',
    );
    expect(source).toContain('waitlistRegistration.questionAnswers');
    expect(source).toContain(
      'Participants can leave the waitlist before the event starts, which cancels the waitlist registration and releases the waitlist position.',
    );
    expect(source).toContain(
      'the oldest waitlisted participant receives a spot-available email telling them to return to the event page while the spot is still available.',
    );
    expect(source).toContain(
      'A completed unpaid transfer queues a transfer-completed email for the new participant',
    );
    expect(source).toContain(
      'The email tells the new participant to open Evorto for the registration details.',
    );
    expect(source).toContain('fullOptionAfterLeaving.waitlistSpots');
    expect(source).not.toContain('Register button stays available');
    expect(source).not.toContain('paid transfers are automatic');
    expect(source).not.toContain('resale is automatic');
    expect(source).not.toContain(
      'Paid registration transfer and resale are not automatic yet.',
    );
    expect(source).not.toContain(
      'Resale listing workflows are not available yet.',
    );
    expect(source).not.toContain('ticket QR code by email');
  });

  it('keeps event approval docs backed by deterministic lifecycle persistence checks', () => {
    const source = readSource('tests/docs/events/event-approval.doc.ts');

    expect(source).toContain('Approval Flow ${seedDate.getTime()}');
    expect(source).toContain('Expected generated approval docs event to exist');
    expect(source).toContain('const eventStatusSurface =');
    expect(source).toContain('const submitForReviewDialogSurface =');
    expect(source).toContain('const rejectEventDialogSurface =');
    expect(source).toContain(
      "has: page.getByRole('heading', { name: 'Submit Event for Review' })",
    );
    expect(source).toContain(
      'locked for editing until it is either approved or rejected',
    );
    expect(source).toContain(
      "has: page.getByRole('heading', { name: 'Review Event' })",
    );
    expect(source).toContain("has: page.getByLabel('Review Comment')");
    expect(source).toContain('const draftStatusSurface =');
    expect(source).toContain("eventStatusSurface(page, [\n      'Draft',");
    expect(source).toContain("'Submit for Review',");
    expect(source).toContain(
      "const submitButton = draftStatusSurface.getByRole('button',",
    );
    expect(source).toContain(
      'Draft event status with submit-for-review action',
    );
    expect(source).toContain('Submit event for review confirmation dialog');
    expect(source).toContain(
      'Reject event dialog with required review comment field',
    );
    expect(source).toContain("eventStatusSurface(page, 'Pending Review')");
    expect(source).toContain('const rejectedStatusSurface =');
    expect(source).toContain('eventStatusSurface(page, [');
    expect(source).toContain(
      "expect((await readGeneratedEvent()).status).toBe('PENDING_REVIEW')",
    );
    expect(source).toContain("expect(rejectedEvent.status).toBe('REJECTED')");
    expect(source).toContain(
      'expect(rejectedEvent.statusComment).toBe(rejectionComment)',
    );
    expect(source).toContain("expect(approvedEvent.status).toBe('APPROVED')");
    expect(source).toContain('const publishedStatusSurface =');
    expect(source).toContain("eventStatusSurface(page, 'Published')");
    expect(source).toContain('final **Published** state');
    expect(source).toContain('Published event status');
    expect(source).not.toContain(
      'takeScreenshot(\n      testInfo,\n      page.getByText(rejectionComment).first(),',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-event-status').first(),",
    );
    expect(source).not.toContain(
      "const submitButton = page.getByRole('button', {\n      name: 'Submit for Review',\n    });",
    );
    expect(source).not.toContain(
      'takeScreenshot(\n      testInfo,\n      submitButton,',
    );
    expect(source).not.toContain(
      "page\n      .locator('mat-dialog-container')\n      .first()\n      .getByRole('button', { name: 'Submit for Review' })",
    );
    expect(source).not.toContain('final published state');
    expect(source).toContain('.delete(schema.eventRegistrationOptions)');
    expect(source).toContain('.delete(schema.eventInstances)');
    expect(source).not.toContain(
      'Approval Flow ${seedDate.toISOString().slice(0, 10)}',
    );
  });

  it('keeps event-management docs aligned with scanner and organizer scope', () => {
    const source = readSource('tests/docs/events/event-management.doc.ts');

    expect(source).toContain(
      'The event management feature allows you to create and edit events, configure registration options, review listing state, inspect the organizer participant overview, and handle event receipts.',
    );
    expect(source).toContain(
      'Organizers check in attendees from the dedicated QR scanner.',
    );
    expect(source).toContain('- Event receipt submission and receipt list');
    expect(source).toContain('const receiptSubmissionDialogSurface =');
    expect(source).toContain("page.getByRole('heading', { name: 'Receipts' })");
    expect(source).toContain(
      "page.getByRole('button', { name: 'Add receipt' }).click()",
    );
    expect(source).toContain("page.getByLabel('Deposit involved').check()");
    expect(source).toContain("page.getByLabel('Alcohol purchased').check()");
    expect(source).toContain("page.getByLabel('Total amount (EUR)')");
    expect(source).toContain(
      'input[type="file"][accept="image/*,application/pdf"]',
    );
    expect(source).toContain('sample-receipt.pdf');
    expect(source).toContain(
      'Receipt submission dialog with amount country and file controls',
    );
    expect(source).toContain(
      'The scanned-registration page shows the attendee, event, registration option, ESNcard discount marker when applicable, guest check-in progress when guests are attached to the registration, and warnings for self-scan, future events, non-confirmed registrations, and already checked-in tickets.',
    );
    expect(source).toContain(
      'Confirming check-in records the registration check-in time and updates the checked-in count shown on the organizer overview.',
    );
    expect(source).toContain(
      'When a registration includes guests, the organizer chooses how many guests arrived with the attendee, and the checked-in count increases by the attendee plus the selected guests.',
    );
    expect(source).toContain(
      'page.goto(`/scan/registration/${scannerRegistrationId}`)',
    );
    expect(source).toContain("page.getByText('Includes 2 guests.')");
    expect(source).toContain(
      "page.getByRole('button', { name: 'Confirm 3 check-ins' })",
    );
    expect(source).toContain('const scannerGuestCheckInSurface =');
    expect(source).toContain("locator('app-handle-registration')");
    expect(source).toContain("filter({ hasText: 'Includes 2 guests.' })");
    expect(source).toContain(
      "filter({ hasText: '0 checked in, 2 remaining.' })",
    );
    expect(source).toContain(
      "filter({ has: page.getByLabel('Guests to check in now') })",
    );
    expect(source).toContain(
      'const scannerCheckIn = scannerGuestCheckInSurface',
    );
    expect(source).toContain('Scanned registration with guest check-in');
    expect(source).toContain("page.getByText('Check-in recorded')");
    expect(source).toContain('checkedInGuestCount: true');
    expect(source).toContain('checkedInSpots: initialCheckedInSpots + 3');
    expect(source).toContain('.update(eventRegistrationOptions)');
    expect(source).toContain('.set({ checkedInSpots: initialCheckedInSpots })');
    expect(source).toContain(
      "Organizers can also cancel a participant's confirmed registration from the organizer overview before check-in, which releases the confirmed spot and submits a Stripe refund when the paid registration has a stored Stripe payment reference.",
    );
    expect(source).toContain(
      'Older or manually seeded payment records still create a pending manual refund record for organizer follow-up.',
    );
    expect(source).toContain(
      'Paid registrations stay unavailable for direct organizer-assisted transfer and use participant-created transfer codes for replacement checkout and source refund handling.',
    );
    expect(source).toContain(
      'It does not currently include attendee export, attendee messaging, manual check-in controls outside QR scanning',
    );
    expect(source).toContain(
      'Role picker behavior: already selected roles are hidden from suggestions to avoid duplicate eligibility entries.',
    );
    expect(source).toContain('const eventListSurface =');
    expect(source).toContain("page.locator('app-event-list nav')");
    expect(source).toContain('const templateChoiceSurface =');
    expect(source).toContain("locator('app-template-list nav > div')");
    expect(source).toContain('const eventDetailsSurface =');
    expect(source).toContain("locator('router-outlet + * header')");
    expect(source).toContain('const registrationOptionSurface =');
    expect(source).toContain("locator('app-event-registration-option')");
    expect(source).toContain(
      "has: page.getByRole('heading', { name: input.optionTitle })",
    );
    expect(source).toContain("filter({ hasText: 'Participant option' })");
    expect(source).toContain(
      '// The remaining screenshots use a seeded event with the same event-details surface.',
    );
    expect(source).toContain(
      'await page.goto(`/events/${target.id}`);',
    );
    expect(source).toContain(
      'Expected seeded event "${target.title}" to have a participant registration option for docs screenshots',
    );
    expect(source).toContain('createdParticipantRegistrationOption');
    expect(source).toContain(
      'const registrationOptions = registrationOptionSurface(page',
    );
    expect(source).not.toContain(
      "page.locator('app-event-registration-option').first()",
    );
    expect(source).toContain('const rolePickerSurface =');
    expect(source).toContain("locator('app-registration-option-form')");
    expect(source).toContain('const eventStatusActionSurface =');
    expect(source).toContain("locator('app-event-status')");
    expect(source).toContain(
      "filter({ has: page.getByRole('link', { name: 'Edit Event' }) })",
    );
    expect(source).toContain(
      'Expected seeded draft event for event-management role autocomplete docs',
    );
    expect(source).toContain(
      'Expected seeded event-management docs draft event "${draftEvent.title}" to have selected registration roles',
    );
    expect(source).toContain(
      'Expected seeded event-management docs draft event "${draftEvent.title}" to have an unselected role for autocomplete',
    );
    expect(source).toContain("page.getByPlaceholder('Add Role...')");
    expect(source).toContain('Event edit role picker duplicate prevention');
    expect(source).toContain(
      'const statusActions = eventStatusActionSurface(page)',
    );
    expect(source).toContain(
      "await expect(statusActions.locator('app-event-status')).toBeVisible()",
    );
    expect(source).toContain('Event status and management action surface');
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('heading', { level: 1, name: 'Events' })",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('heading', {\n      level: 1,\n      name: 'Event templates',",
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    page.locator(`h1:has-text("${templateName}")`)',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('heading', { level: 2, name: 'Registration' })",
    );
    expect(source).not.toContain(
      'takeScreenshot(\n      testInfo,\n      statusChip,',
    );
    expect(source).not.toContain(
      'page\n    .getByText(/Draft|Pending Review|Published|Rejected/i)\n    .first()',
    );
    expect(source).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-handle-registration'),",
    );
    expect(source).not.toContain('manual check-in from the organizer overview');
    expect(source).not.toContain('managing attendees');
    expect(source).not.toContain('automatic refund controls are available');
    expect(source).not.toContain('paid registration transfer is available');
  });

  it('keeps role docs aligned with generated permission reference semantics', () => {
    const rolesSource = readSource('tests/docs/roles/roles.doc.ts');
    const permissionsSource = readSource(
      'tests/docs/roles/about-permissions.doc.ts',
    );

    expect(rolesSource).toContain(
      'Learn more at [about permissions](/docs/about-permissions).',
    );
    expect(rolesSource).toContain(
      'Permissions that are required by another permission are automatically included and shown as non-editable dependent permissions with the same admin-facing labels used in the permission reference.',
    );
    expect(rolesSource).toContain('Role docs ${seedDate.getTime()}');
    expect(rolesSource).toContain('const readOnlyUserListSurface =');
    expect(rolesSource).toContain("locator('app-user-list')");
    expect(rolesSource).toContain(
      'Existing-user role assignment is deferred for relaunch.',
    );
    expect(rolesSource).toContain(
      "getByRole('cell', {\n        exact: true,\n        name: 'admin@evorto.app',",
    );
    expect(rolesSource).toContain('const userList = readOnlyUserListSurface');
    expect(rolesSource).toContain('Read-only tenant user list');
    expect(rolesSource).toContain('const roleListCreateSurface =');
    expect(rolesSource).toContain("locator('app-role-list')");
    expect(rolesSource).toContain(
      "has: page.getByRole('heading', {\n        name: 'User roles',",
    );
    expect(rolesSource).toContain(
      "filter({ has: page.getByRole('link', { name: 'Create role' }) })",
    );
    expect(rolesSource).toContain('const roleListCreateAction =');
    expect(rolesSource).toContain(
      'User roles page with the create-role action highlighted',
    );
    expect(rolesSource).toContain(
      'Saved role detail page with dependent permissions visible',
    );
    expect(rolesSource).toContain('const roleFormPermissionGroupSurface =');
    expect(rolesSource).toContain("locator('app-role-form div')");
    expect(rolesSource).toContain(
      "getByRole('checkbox', { exact: true, name: 'Events' })",
    );
    expect(rolesSource).toContain('Includes: View templates');
    expect(rolesSource).toContain('const savedRoleDetailSurface =');
    expect(rolesSource).toContain("locator('app-role-details div')");
    expect(rolesSource).toContain('filter({ hasText: roleDescription })');
    expect(rolesSource).toContain("filter({ hasText: 'Create events' })");
    expect(rolesSource).toContain("filter({ hasText: 'View templates' })");
    expect(rolesSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('checkbox', { exact: true, name: 'Events' })",
    );
    expect(rolesSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('heading', { name: roleName })",
    );
    expect(rolesSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.locator('app-user-list')",
    );
    expect(rolesSource).not.toContain(
      "takeScreenshot(\n      testInfo,\n      page.getByRole('link', { name: 'Create role' })",
    );
    expect(rolesSource).toContain(
      "throw new Error('Expected generated roles doc to persist the role')",
    );
    expect(rolesSource).toContain(
      "createdRole.permissions).toContain('events:create')",
    );
    expect(rolesSource).toContain(
      "createdRole.permissions).toContain('templates:view')",
    );
    expect(rolesSource).toContain('.delete(schema.roles)');
    expect(permissionsSource).toContain(
      'Permissions are tenant-scoped capabilities assigned through roles.',
    );
    expect(permissionsSource).toContain(
      'Wildcard permissions such as \\`events:*\\` grant the permissions in that group.',
    );
    expect(permissionsSource).toContain(
      'Some permissions also include dependent permissions so the user can reach the screens needed to use the parent capability.',
    );
    expect(permissionsSource).toContain('PERMISSION_GROUPS');
    expect(permissionsSource).toContain('PERMISSION_DEPENDENCIES');
    expect(permissionsSource).toContain(
      'const permissionGroupReferenceSurface =',
    );
    expect(permissionsSource).toContain("locator('app-role-form div')");
    expect(permissionsSource).toContain(
      "getByRole('checkbox', { exact: true, name: 'Events' })",
    );
    expect(permissionsSource).toContain('Includes: View templates');
    expect(permissionsSource).toContain(
      'Permission group reference with dependent permissions visible',
    );
    expect(permissionsSource).not.toMatch(/global-admin|global admin/i);
    expect(permissionsSource).not.toContain('Global admin access is a role');
    expect(permissionsSource).not.toContain('tenant roles grant global admin');
  });

  it('keeps ESN discount docs aligned with provider-error and write-guard behavior', () => {
    const source = readSource('tests/docs/profile/discounts.doc.ts');

    expect(source).toContain('esnCardStatusLabel');
    expect(source).toContain('esnCardActionLabel');
    expect(source).toContain('esnCardActionDisabled');
    expect(source).toContain('esnCardSaveDisabled');
    expect(source).toContain('esnCardSubmitPayloadFromIdentifier');
    expect(source).toContain('esnCardMutationErrorMessage');
    expect(source).toContain(
      'The profile discount-card form stores one ESN card per user and trims the card number before validation.',
    );
    expect(source).toContain(
      'Save, refresh, and remove stay disabled while any ESNcard write is pending',
    );
    expect(source).toContain(
      'Provider outages are not treated as invalid cards.',
    );
    expect(source).toContain(
      'Evorto leaves the stored ESN card unchanged so the user can retry later.',
    );
    expect(source).toContain("page.goto('/profile#discounts')");
    expect(source).toContain(
      "page.getByRole('heading', { level: 2, name: 'Discount Cards' })",
    );
    expect(source).toContain('const esnDiscountCardSurface =');
    expect(source).toContain("locator('app-user-profile div')");
    expect(source).toContain('filter({ hasText: input.identifier })');
    expect(source).toContain("filter({ hasText: 'Status: Verified' })");
    expect(source).toContain("filter({ hasText: 'Refresh' })");
    expect(source).toContain("filter({ hasText: 'Remove' })");
    expect(source).toContain('const seededDiscountCard =');
    expect(source).toContain('await expect(seededDiscountCard).toBeVisible()');
    expect(source).toContain('const esnDiscountFormSurface =');
    expect(source).toContain("locator('app-user-profile section')");
    expect(source).toContain(
      "has: page.getByRole('heading', { level: 2, name: 'Discount Cards' })",
    );
    expect(source).toContain(
      "has: page.getByRole('button', { name: 'Save ESN card' })",
    );
    expect(source).toContain('const providerOutageForm =');
    expect(source).toContain('const invalidCardForm =');
    expect(source).toContain('unchangedSeededEsnCard');
    expect(source).toContain(
      "page.getByRole('button', { name: 'Save ESN card' })",
    );
    expect(source).toContain(
      'Discount card form showing invalid ESN card validation',
    );
    expect(source).toContain('TESTESNDOWN');
    expect(source).toContain(
      'Discount card provider outage keeps the stored card unchanged',
    );
    expect(source).toContain('providerOutageSeededEsnCard');
    expect(source).toContain('ESNcard validation provider is unavailable');
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByRole('heading', { level: 2, name: 'Discount Cards' })",
    );
    expect(source).not.toContain(
      "takeScreenshot(\n    testInfo,\n    page.getByText('Could not validate ESN card right now. Try again later.'),",
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    page.getByText(/Enter a valid ESN card number/),',
    );
    expect(source).not.toContain('provider outages mark the card invalid');
    expect(source).not.toContain('overlap ESNcard writes');
    expect(source).not.toContain('stores the card number without trimming');
  });
});
