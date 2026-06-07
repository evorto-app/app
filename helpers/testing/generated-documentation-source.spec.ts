import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import nodePath from 'node:path';
import * as ts from 'typescript';
import { describe, expect, it } from 'vitest';

// Source guard: generated documentation is product-facing, so these checks keep
// the docs tied to implemented flows instead of stale aspirational copy.
const repositoryRoot = new URL('../..', import.meta.url).pathname;

const readSource = (path: string): string =>
  readFileSync(nodePath.join(repositoryRoot, path), 'utf8');

const extractMarkdownListAfter = (source: string, marker: string): string[] => {
  const markerIndex = source.indexOf(marker);

  if (markerIndex === -1) {
    throw new Error(`Markdown marker not found: ${marker}`);
  }

  const listItems: string[] = [];
  const lines = source.slice(markerIndex + marker.length).split(/\r?\n/u);

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith('- ')) {
      listItems.push(trimmed.slice(2).trim());
      continue;
    }

    if (listItems.length > 0 && trimmed.length === 0) {
      break;
    }
  }

  return listItems;
};

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
    ts.isNonNullExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    (ts.isBinaryExpression(current) &&
      current.operatorToken.kind === ts.SyntaxKind.CommaToken)
  ) {
    current = ts.isBinaryExpression(current)
      ? current.right
      : current.expression;
  }

  return current;
};

const unwrapArrayElement = (node: ts.Expression): ts.Expression =>
  ts.isSpreadElement(node)
    ? unwrapExpression(node.expression)
    : unwrapExpression(node);

const returnsTrackedTarget = (
  node: ts.Expression,
  isTrackedTarget: (node: ts.Expression) => boolean,
  options: { trackedCallbackNames?: ReadonlySet<string> } = {},
): boolean => {
  const expression = unwrapExpression(node);

  if (ts.isIdentifier(expression)) {
    return options.trackedCallbackNames?.has(expression.text) === true;
  }

  if (ts.isArrowFunction(expression) && !ts.isBlock(expression.body)) {
    return isTrackedTarget(expression.body);
  }

  if (!ts.isArrowFunction(expression) && !ts.isFunctionExpression(expression)) {
    return false;
  }

  if (!ts.isBlock(expression.body)) {
    return false;
  }

  let returnsTracked = false;

  const visitReturn = (child: ts.Node): void => {
    if (
      child !== expression.body &&
      (ts.isArrowFunction(child) || ts.isFunctionExpression(child))
    ) {
      return;
    }

    if (
      ts.isReturnStatement(child) &&
      child.expression &&
      isTrackedTarget(child.expression)
    ) {
      returnsTracked = true;
    }

    ts.forEachChild(child, visitReturn);
  };

  visitReturn(expression.body);

  return returnsTracked;
};

const getStaticIntegerIndex = (node: ts.Expression): null | number => {
  const expression = unwrapExpression(node);

  if (ts.isNumericLiteral(expression)) {
    const index = Number(expression.text);

    return Number.isInteger(index) ? index : null;
  }

  if (
    ts.isPrefixUnaryExpression(expression) &&
    expression.operator === ts.SyntaxKind.MinusToken &&
    ts.isNumericLiteral(expression.operand)
  ) {
    const index = Number(expression.operand.text);

    return Number.isInteger(index) ? -index : null;
  }

  return null;
};

const isTrackedArrayTarget = (
  node: ts.Expression,
  isTrackedTarget: (node: ts.Expression) => boolean,
  options: {
    emptyArrayIsTracked?: boolean;
    trackedCallbackNames?: ReadonlySet<string>;
  } = {},
): boolean => {
  const target = unwrapExpression(node);

  if (ts.isArrayLiteralExpression(target)) {
    return (
      (options.emptyArrayIsTracked === true && target.elements.length === 0) ||
      target.elements.some((element) =>
        isTrackedTarget(unwrapArrayElement(element)),
      )
    );
  }

  if (!ts.isCallExpression(target)) {
    return false;
  }

  const callee = unwrapExpression(target.expression);

  if (
    ts.isPropertyAccessExpression(callee) ||
    ts.isElementAccessExpression(callee)
  ) {
    const methodName = getStaticPropertyName(callee);
    const receiver = getStaticPropertyReceiver(callee);
    const unwrappedReceiver = receiver ? unwrapExpression(receiver) : null;

    if (
      methodName === 'of' &&
      unwrappedReceiver &&
      ts.isIdentifier(unwrappedReceiver) &&
      unwrappedReceiver.text === 'Array'
    ) {
      return (
        (options.emptyArrayIsTracked === true &&
          target.arguments.length === 0) ||
        target.arguments.some((argument) => isTrackedTarget(argument))
      );
    }

    if (
      methodName === 'from' &&
      unwrappedReceiver &&
      ts.isIdentifier(unwrappedReceiver) &&
      unwrappedReceiver.text === 'Array'
    ) {
      const sourceArgument = target.arguments[0];
      const mapperArgument = target.arguments[1];

      return (
        (sourceArgument
          ? isTrackedArrayTarget(sourceArgument, isTrackedTarget, options) ||
            isTrackedTarget(sourceArgument)
          : options.emptyArrayIsTracked === true) ||
        (!!mapperArgument &&
          returnsTrackedTarget(mapperArgument, isTrackedTarget, options))
      );
    }

    if (methodName === 'at' && receiver && target.arguments[0]) {
      const index = getStaticIntegerIndex(target.arguments[0]);

      if (index === null) {
        return isTrackedArrayTarget(receiver, isTrackedTarget, options);
      }

      if (unwrappedReceiver && ts.isArrayLiteralExpression(unwrappedReceiver)) {
        const resolvedIndex =
          index >= 0 ? index : unwrappedReceiver.elements.length + index;
        const element = unwrappedReceiver.elements[resolvedIndex];

        return element ? isTrackedTarget(unwrapArrayElement(element)) : false;
      }

      return isTrackedArrayTarget(receiver, isTrackedTarget, options);
    }

    if (methodName === 'toSpliced') {
      return (
        (receiver
          ? isTrackedArrayTarget(receiver, isTrackedTarget, options)
          : false) ||
        target.arguments.slice(2).some((argument) => isTrackedTarget(argument))
      );
    }

    if (methodName === 'with') {
      return (
        (receiver
          ? isTrackedArrayTarget(receiver, isTrackedTarget, options)
          : false) ||
        (!!target.arguments[1] && isTrackedTarget(target.arguments[1]))
      );
    }

    if (methodName === 'fill') {
      return (
        (receiver
          ? isTrackedArrayTarget(receiver, isTrackedTarget, options)
          : false) ||
        (!!target.arguments[0] && isTrackedTarget(target.arguments[0]))
      );
    }

    if (methodName === 'map' || methodName === 'flatMap') {
      return (
        (receiver
          ? isTrackedArrayTarget(receiver, isTrackedTarget, options)
          : false) ||
        target.arguments.some((argument) =>
          returnsTrackedTarget(argument, isTrackedTarget, options),
        )
      );
    }

    if (methodName === 'reduce' || methodName === 'reduceRight') {
      return (
        (receiver
          ? isTrackedArrayTarget(receiver, isTrackedTarget, options)
          : false) ||
        target.arguments.some(
          (argument, index) =>
            (index === 0 &&
              returnsTrackedTarget(argument, isTrackedTarget, options)) ||
            (index > 0 && isTrackedTarget(argument)),
        )
      );
    }

    if (
      methodName === 'flat' ||
      methodName === 'copyWithin' ||
      methodName === 'find' ||
      methodName === 'findLast' ||
      methodName === 'filter' ||
      methodName === 'pop' ||
      methodName === 'reverse' ||
      methodName === 'shift' ||
      methodName === 'slice' ||
      methodName === 'splice' ||
      methodName === 'sort' ||
      methodName === 'toReversed' ||
      methodName === 'toSorted'
    ) {
      return receiver
        ? isTrackedArrayTarget(receiver, isTrackedTarget, options)
        : false;
    }

    if (methodName === 'concat') {
      return (
        (receiver
          ? isTrackedArrayTarget(receiver, isTrackedTarget, options) ||
            isTrackedTarget(receiver)
          : false) ||
        target.arguments.some(
          (argument) =>
            isTrackedArrayTarget(argument, isTrackedTarget, options) ||
            isTrackedTarget(argument),
        )
      );
    }
  }

  return false;
};

const isTrackedBranchingTarget = (
  node: ts.Expression,
  isTrackedTarget: (node: ts.Expression) => boolean,
): boolean => {
  const target = unwrapExpression(node);

  if (ts.isConditionalExpression(target)) {
    return (
      isTrackedTarget(target.whenTrue) ||
      isTrackedBranchingTarget(target.whenTrue, isTrackedTarget) ||
      isTrackedTarget(target.whenFalse) ||
      isTrackedBranchingTarget(target.whenFalse, isTrackedTarget)
    );
  }

  if (
    ts.isBinaryExpression(target) &&
    (target.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      target.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      target.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return (
      isTrackedTarget(target.left) ||
      isTrackedBranchingTarget(target.left, isTrackedTarget) ||
      isTrackedTarget(target.right) ||
      isTrackedBranchingTarget(target.right, isTrackedTarget)
    );
  }

  return false;
};

const collectDestructuredPropertyAliases = (
  node: ts.VariableDeclaration,
  sourceFile: ts.SourceFile,
  propertyAliases: ReadonlySet<string>,
  aliases: Set<string>,
  stringAliases: ReadonlyMap<string, string> = new Map(),
): void => {
  if (
    !node.initializer ||
    !ts.isIdentifier(unwrapExpression(node.initializer))
  ) {
    return;
  }

  const sourceObject = unwrapExpression(node.initializer);

  if (!ts.isIdentifier(sourceObject)) {
    return;
  }

  if (ts.isObjectBindingPattern(node.name)) {
    for (const element of node.name.elements) {
      if (!ts.isIdentifier(element.name)) {
        continue;
      }

      const propertyName = element.propertyName ?? element.name;

      const aliasedStaticPropertyName = getStaticPropertyNameFromName(
        propertyName,
        stringAliases,
      );

      if (
        aliasedStaticPropertyName &&
        propertyAliases.has(`${sourceObject.text}.${aliasedStaticPropertyName}`)
      ) {
        aliases.add(element.name.text);
      }
    }

    return;
  }

  if (ts.isArrayBindingPattern(node.name)) {
    node.name.elements.forEach((element, index) => {
      if (ts.isOmittedExpression(element) || !ts.isIdentifier(element.name)) {
        return;
      }

      if (propertyAliases.has(`${sourceObject.text}.${index}`)) {
        aliases.add(element.name.text);
      }
    });
  }
};

const collectIndexedPropertyAliases = (
  ownerName: string,
  elements: ts.NodeArray<ts.Expression>,
  isTrackedReference: (node: ts.Expression) => boolean,
  propertyAliases: Set<string>,
): void => {
  elements.forEach((element, index) => {
    if (isTrackedReference(element)) {
      propertyAliases.add(`${ownerName}.${index}`);
      propertyAliases.add(`${ownerName}.${index - elements.length}`);
    }
  });
};

const addBindingIdentifiers = (
  name: ts.BindingName,
  aliases: Set<string>,
): void => {
  if (ts.isIdentifier(name)) {
    aliases.add(name.text);
    return;
  }

  for (const element of name.elements) {
    if (!ts.isOmittedExpression(element)) {
      addBindingIdentifiers(element.name, aliases);
    }
  }
};

const getBindingIdentifierNames = (name: ts.BindingName): string[] => {
  if (ts.isIdentifier(name)) {
    return [name.text];
  }

  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element)
      ? []
      : getBindingIdentifierNames(element.name),
  );
};

const collectPropertyBindingAliases = (
  name: ts.BindingName,
  propertyName: string,
  aliases: Set<string>,
  stringAliases: ReadonlyMap<string, string> = new Map(),
): void => {
  if (ts.isIdentifier(name)) {
    return;
  }

  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }

    if (ts.isArrayBindingPattern(name)) {
      collectPropertyBindingAliases(
        element.name,
        propertyName,
        aliases,
        stringAliases,
      );
      continue;
    }

    const staticPropertyName = getStaticPropertyNameFromName(
      element.propertyName ?? element.name,
      stringAliases,
    );

    if (staticPropertyName === propertyName) {
      addBindingIdentifiers(element.name, aliases);
      continue;
    }

    collectPropertyBindingAliases(
      element.name,
      propertyName,
      aliases,
      stringAliases,
    );
  }
};

const collectBindingInitializerAliases = (
  name: ts.BindingName,
  isTrackedReference: (node: ts.Expression) => boolean,
  aliases: Set<string>,
): void => {
  if (ts.isIdentifier(name)) {
    return;
  }

  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue;
    }

    if (element.initializer && isTrackedReference(element.initializer)) {
      addBindingIdentifiers(element.name, aliases);
    }

    collectBindingInitializerAliases(element.name, isTrackedReference, aliases);
  }
};

const collectObjectRestBindingAliases = (
  node: ts.VariableDeclaration,
  isTrackedReference: (node: ts.Expression) => boolean,
  aliases: Set<string>,
): void => {
  if (
    !node.initializer ||
    !ts.isObjectBindingPattern(node.name) ||
    !isTrackedReference(node.initializer)
  ) {
    return;
  }

  for (const element of node.name.elements) {
    if (element.dotDotDotToken) {
      addBindingIdentifiers(element.name, aliases);
    }
  }
};

const collectObjectRestPropertyAliases = (
  node: ts.VariableDeclaration,
  propertyAliases: Set<string>,
): void => {
  if (
    !node.initializer ||
    !ts.isObjectBindingPattern(node.name) ||
    !ts.isIdentifier(unwrapExpression(node.initializer))
  ) {
    return;
  }

  const sourceObject = unwrapExpression(node.initializer);

  if (!ts.isIdentifier(sourceObject)) {
    return;
  }

  const sourcePrefix = `${sourceObject.text}.`;
  const copiedPropertyAliases = [...propertyAliases].filter((propertyAlias) =>
    propertyAlias.startsWith(sourcePrefix),
  );

  if (copiedPropertyAliases.length === 0) {
    return;
  }

  for (const element of node.name.elements) {
    if (!element.dotDotDotToken) {
      continue;
    }

    for (const targetName of getBindingIdentifierNames(element.name)) {
      for (const propertyAlias of copiedPropertyAliases) {
        propertyAliases.add(
          `${targetName}.${propertyAlias.slice(sourcePrefix.length)}`,
        );
      }
    }
  }
};

const isTrackedReferenceOrAlias = (
  node: ts.Expression,
  isTrackedReference: (node: ts.Expression) => boolean,
  aliases: ReadonlySet<string>,
): boolean => {
  const expression = unwrapExpression(node);

  return (
    isTrackedReference(node) ||
    (ts.isIdentifier(expression) && aliases.has(expression.text))
  );
};

const collectGroupedPropertyAliases = (
  ownerName: string,
  initializer: ts.Expression,
  isTrackedReference: (node: ts.Expression) => boolean,
  aliases: ReadonlySet<string>,
  propertyAliases: Set<string>,
  stringAliases: ReadonlyMap<string, string> = new Map(),
): void => {
  const groupedInitializer = unwrapExpression(initializer);

  if (ts.isObjectLiteralExpression(groupedInitializer)) {
    for (const property of groupedInitializer.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        isTrackedReferenceOrAlias(
          property.initializer,
          isTrackedReference,
          aliases,
        )
      ) {
        const propertyName = getStaticPropertyNameFromName(
          property.name,
          stringAliases,
        );

        if (propertyName) {
          propertyAliases.add(`${ownerName}.${propertyName}`);
        }
      }

      if (
        ts.isShorthandPropertyAssignment(property) &&
        aliases.has(property.name.text)
      ) {
        propertyAliases.add(`${ownerName}.${property.name.text}`);
      }
    }
  }

  if (ts.isArrayLiteralExpression(groupedInitializer)) {
    collectIndexedPropertyAliases(
      ownerName,
      groupedInitializer.elements,
      (element) =>
        isTrackedReferenceOrAlias(element, isTrackedReference, aliases),
      propertyAliases,
    );
  }
};

const isTakeScreenshotCall = (node: ts.CallExpression): boolean => {
  const callee = unwrapExpression(node.expression);

  return ts.isIdentifier(callee) && callee.text === 'takeScreenshot';
};

const resolveStaticStringValue = (
  node: ts.Expression,
  stringAliases: ReadonlyMap<string, string> = new Map(),
): null | string => {
  const expression = unwrapExpression(node);

  if (
    ts.isStringLiteral(expression) ||
    ts.isNoSubstitutionTemplateLiteral(expression)
  ) {
    return expression.text;
  }

  if (ts.isIdentifier(expression)) {
    return stringAliases.get(expression.text) ?? null;
  }

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = resolveStaticStringValue(expression.left, stringAliases);
    const right = resolveStaticStringValue(expression.right, stringAliases);

    return left !== null && right !== null ? `${left}${right}` : null;
  }

  if (ts.isTemplateExpression(expression)) {
    let value = expression.head.text;

    for (const span of expression.templateSpans) {
      const spanValue = resolveStaticStringValue(
        span.expression,
        stringAliases,
      );

      if (spanValue === null) {
        return null;
      }

      value += spanValue + span.literal.text;
    }

    return value;
  }

  return null;
};

const collectStaticStringAliases = (
  sourceFile: ts.SourceFile,
): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>();
  let changed = true;

  while (changed) {
    changed = false;

    const visit = (node: ts.Node): void => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.initializer
      ) {
        const value = resolveStaticStringValue(node.initializer, aliases);

        if (value !== null && aliases.get(node.name.text) !== value) {
          aliases.set(node.name.text, value);
          changed = true;
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  return aliases;
};

const getStaticPropertyName = (
  node: ts.Expression,
  stringAliases: ReadonlyMap<string, string> = new Map(),
): null | string => {
  const expression = unwrapExpression(node);

  if (ts.isPropertyAccessExpression(expression)) {
    return expression.name.text;
  }

  if (ts.isElementAccessExpression(expression)) {
    const argument = unwrapExpression(expression.argumentExpression);
    const staticStringValue = resolveStaticStringValue(argument, stringAliases);

    if (staticStringValue !== null) {
      return staticStringValue;
    }

    if (ts.isNumericLiteral(argument)) {
      return argument.text;
    }
  }

  return null;
};

const getLiteralText = (
  node: ts.Expression,
  stringAliases: ReadonlyMap<string, string> = new Map(),
): null | string => {
  return resolveStaticStringValue(node, stringAliases);
};

const getIdentifierText = (node: ts.Expression): null | string => {
  const expression = unwrapExpression(node);

  return ts.isIdentifier(expression) ? expression.text : null;
};

const getStaticPropertyNameFromName = (
  node: ts.PropertyName,
  stringAliases: ReadonlyMap<string, string> = new Map(),
): null | string => {
  if (
    ts.isIdentifier(node) ||
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node)
  ) {
    return node.text;
  }

  if (ts.isComputedPropertyName(node)) {
    return resolveStaticStringValue(node.expression, stringAliases);
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

const isReflectApplyCallee = (node: ts.Expression): boolean => {
  const callee = unwrapExpression(node);

  if (
    !ts.isPropertyAccessExpression(callee) &&
    !ts.isElementAccessExpression(callee)
  ) {
    return false;
  }

  const receiver = unwrapExpression(
    getStaticPropertyReceiver(callee) ?? callee,
  );

  return (
    ts.isIdentifier(receiver) &&
    receiver.text === 'Reflect' &&
    getStaticPropertyName(callee) === 'apply'
  );
};

const isStaticObjectAssignCall = (
  node: ts.Expression,
  stringAliases: ReadonlyMap<string, string> = new Map(),
): node is ts.CallExpression => {
  const expression = unwrapExpression(node);

  if (!ts.isCallExpression(expression)) {
    return false;
  }

  const callee = unwrapExpression(expression.expression);

  if (
    !ts.isPropertyAccessExpression(callee) &&
    !ts.isElementAccessExpression(callee)
  ) {
    return false;
  }

  const receiver = unwrapExpression(
    getStaticPropertyReceiver(callee) ?? callee,
  );

  return (
    ts.isIdentifier(receiver) &&
    receiver.text === 'Object' &&
    getStaticPropertyName(callee, stringAliases) === 'assign'
  );
};

const getStaticPropertyReference = (
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  stringAliases: ReadonlyMap<string, string> = new Map(),
): null | string => {
  const propertyName = getStaticPropertyName(node, stringAliases);
  const receiver = getStaticPropertyReceiver(node);

  if (!propertyName || !receiver) {
    return null;
  }

  return `${unwrapExpression(receiver).getText(sourceFile)}.${propertyName}`;
};

const getStaticArrayMethodReference = (
  node: ts.Expression,
  sourceFile: ts.SourceFile,
  stringAliases: ReadonlyMap<string, string> = new Map(),
): null | string => {
  const expression = unwrapExpression(node);

  if (!ts.isCallExpression(expression) || !expression.arguments[0]) {
    return null;
  }

  const callee = unwrapExpression(expression.expression);

  if (
    !ts.isPropertyAccessExpression(callee) &&
    !ts.isElementAccessExpression(callee)
  ) {
    return null;
  }

  const receiver = getStaticPropertyReceiver(callee);
  const index = getStaticIntegerIndex(expression.arguments[0]);

  if (
    !receiver ||
    getStaticPropertyName(callee, stringAliases) !== 'at' ||
    index === null
  ) {
    return null;
  }

  return `${unwrapExpression(receiver).getText(sourceFile)}.${index}`;
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

const findRawMarkdownImageMarkup = (path: string, source: string): string[] => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const staticStringAliases = collectStaticStringAliases(sourceFile);
  const rawImages: string[] = [];
  const markdownAttachmentNameAliases = new Set<string>();
  const markdownAttachmentNamePropertyAliases = new Set<string>();
  const rawMarkdownBodyAliases = new Set<string>();
  const rawMarkdownBodyPropertyAliases = new Set<string>();
  const rawMarkdownPayloadAliases = new Set<string>();
  const rawMarkdownPayloadPropertyAliases = new Set<string>();
  const markdownAttachFunctionAliases = new Set<string>();
  const markdownAttachFunctionPropertyAliases = new Set<string>();
  const rawMarkdownImagePattern = /!\[[^\]]*\]\([^)]+\)|<img(?:\s|>)/iu;

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const getObjectPropertyValue = (
    objectLiteral: ts.ObjectLiteralExpression,
    propertyName: string,
  ): null | ts.Expression => {
    for (const property of objectLiteral.properties) {
      if (
        ts.isPropertyAssignment(property) &&
        getStaticPropertyNameFromName(property.name, staticStringAliases) ===
          propertyName
      ) {
        return property.initializer;
      }

      if (
        ts.isShorthandPropertyAssignment(property) &&
        property.name.text === propertyName
      ) {
        return property.name;
      }
    }

    return null;
  };

  const getStaticStringValue = (node: ts.Expression): null | string => {
    const expression = unwrapExpression(node);
    const literalText = getLiteralText(expression, staticStringAliases);

    if (literalText !== null) {
      return literalText;
    }

    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = getStaticStringValue(expression.left);
      const right = getStaticStringValue(expression.right);

      return left !== null && right !== null ? `${left}${right}` : null;
    }

    return null;
  };

  const hasPropertyAlias = (
    node: ts.Expression,
    propertyAliases: ReadonlySet<string>,
  ): boolean => {
    const expression = unwrapExpression(node);
    const propertyReference =
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)
        ? getStaticPropertyReference(
            expression,
            sourceFile,
            staticStringAliases,
          )
        : ts.isCallExpression(expression)
          ? getStaticArrayMethodReference(
              expression,
              sourceFile,
              staticStringAliases,
            )
          : null;

    return propertyReference ? propertyAliases.has(propertyReference) : false;
  };

  const hasRawMarkdownImage = (node: ts.Expression): boolean => {
    const expression = unwrapExpression(node);

    if (hasPropertyAlias(expression, rawMarkdownBodyPropertyAliases)) {
      return true;
    }

    if (ts.isCallExpression(expression)) {
      return expression.arguments.some((argument) =>
        hasRawMarkdownImage(argument),
      );
    }

    if (ts.isTemplateExpression(expression)) {
      return expression.templateSpans.some((span) =>
        hasRawMarkdownImage(span.expression),
      );
    }

    if (ts.isConditionalExpression(expression)) {
      return (
        hasRawMarkdownImage(expression.whenTrue) ||
        hasRawMarkdownImage(expression.whenFalse)
      );
    }

    if (
      ts.isBinaryExpression(expression) &&
      [
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.PlusToken,
      ].includes(expression.operatorToken.kind)
    ) {
      return (
        hasRawMarkdownImage(expression.left) ||
        hasRawMarkdownImage(expression.right)
      );
    }

    return (
      (ts.isIdentifier(expression) &&
        rawMarkdownBodyAliases.has(expression.text)) ||
      ((ts.isPropertyAccessExpression(expression) ||
        ts.isElementAccessExpression(expression)) &&
        rawMarkdownBodyPropertyAliases.has(
          getStaticPropertyReference(
            expression,
            sourceFile,
            staticStringAliases,
          ) ?? '',
        )) ||
      rawMarkdownImagePattern.test(expression.getText(sourceFile))
    );
  };

  const isMarkdownAttachmentName = (node: ts.Expression): boolean => {
    const expression = unwrapExpression(node);
    const staticStringValue = getStaticStringValue(expression);

    if (staticStringValue !== null) {
      return staticStringValue === 'markdown';
    }

    if (hasPropertyAlias(expression, markdownAttachmentNamePropertyAliases)) {
      return true;
    }

    if (ts.isCallExpression(expression)) {
      return expression.arguments.some((argument) =>
        isMarkdownAttachmentName(argument),
      );
    }

    if (ts.isTemplateExpression(expression)) {
      return expression.templateSpans.some((span) =>
        isMarkdownAttachmentName(span.expression),
      );
    }

    if (ts.isConditionalExpression(expression)) {
      return (
        isMarkdownAttachmentName(expression.whenTrue) ||
        isMarkdownAttachmentName(expression.whenFalse)
      );
    }

    if (
      ts.isBinaryExpression(expression) &&
      [
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(expression.operatorToken.kind)
    ) {
      return (
        isMarkdownAttachmentName(expression.left) ||
        isMarkdownAttachmentName(expression.right)
      );
    }

    return (
      ts.isIdentifier(expression) &&
      markdownAttachmentNameAliases.has(expression.text)
    );
  };

  const hasRawMarkdownPayload = (node: ts.Expression): boolean => {
    const payload = unwrapExpression(node);

    if (ts.isIdentifier(payload)) {
      return rawMarkdownPayloadAliases.has(payload.text);
    }

    if (isStaticObjectAssignCall(payload, staticStringAliases)) {
      return payload.arguments.some((argument) =>
        hasRawMarkdownPayload(argument),
      );
    }

    if (hasPropertyAlias(payload, rawMarkdownPayloadPropertyAliases)) {
      return true;
    }

    if (!ts.isObjectLiteralExpression(payload)) {
      return false;
    }

    const body = getObjectPropertyValue(payload, 'body');

    return (
      (body ? hasRawMarkdownImage(body) : false) ||
      payload.properties.some(
        (property) =>
          ts.isSpreadAssignment(property) &&
          hasRawMarkdownPayload(property.expression),
      )
    );
  };

  const isAttachFunctionReference = (node: ts.Expression): boolean => {
    const expression = unwrapExpression(node);

    if (
      (ts.isPropertyAccessExpression(expression) ||
        ts.isElementAccessExpression(expression)) &&
      getStaticPropertyName(expression, staticStringAliases) === 'attach'
    ) {
      return true;
    }

    if (
      ts.isCallExpression(expression) &&
      getStaticPropertyName(expression.expression, staticStringAliases) ===
        'bind' &&
      getStaticPropertyName(
        getStaticPropertyReceiver(expression.expression) ??
          expression.expression,
        staticStringAliases,
      ) === 'attach'
    ) {
      return true;
    }

    return false;
  };

  const isTrackedAttachFunctionReference = (node: ts.Expression): boolean => {
    const expression = unwrapExpression(node);

    if (isAttachFunctionReference(expression)) {
      return true;
    }

    if (ts.isIdentifier(expression)) {
      return markdownAttachFunctionAliases.has(expression.text);
    }

    if (hasPropertyAlias(expression, markdownAttachFunctionPropertyAliases)) {
      return true;
    }

    return false;
  };

  const isTrackedAttachCallCallee = (callee: ts.Expression): boolean =>
    isTrackedAttachFunctionReference(callee) ||
    isTrackedBranchingTarget(callee, isTrackedAttachFunctionReference);

  const collectAliases = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const initializer = unwrapExpression(node.initializer);

      if (getLiteralText(initializer, staticStringAliases) === 'markdown') {
        markdownAttachmentNameAliases.add(node.name.text);
      }

      if (hasRawMarkdownImage(initializer)) {
        rawMarkdownBodyAliases.add(node.name.text);
      }

      if (hasRawMarkdownPayload(initializer)) {
        rawMarkdownPayloadAliases.add(node.name.text);
      }

      if (isAttachFunctionReference(initializer)) {
        markdownAttachFunctionAliases.add(node.name.text);
      }

      if (ts.isObjectLiteralExpression(initializer)) {
        for (const property of initializer.properties) {
          const propertyName = getStaticPropertyNameFromName(
            property.name,
            staticStringAliases,
          );
          const propertyInitializer = ts.isPropertyAssignment(property)
            ? unwrapExpression(property.initializer)
            : null;

          if (!propertyName) {
            continue;
          }

          if (
            (propertyInitializer &&
              isMarkdownAttachmentName(propertyInitializer)) ||
            (ts.isShorthandPropertyAssignment(property) &&
              markdownAttachmentNameAliases.has(property.name.text))
          ) {
            markdownAttachmentNamePropertyAliases.add(
              `${node.name.text}.${propertyName}`,
            );
          }

          if (
            (propertyInitializer && hasRawMarkdownImage(propertyInitializer)) ||
            (ts.isShorthandPropertyAssignment(property) &&
              rawMarkdownBodyAliases.has(property.name.text))
          ) {
            rawMarkdownBodyPropertyAliases.add(
              `${node.name.text}.${propertyName}`,
            );
          }

          if (
            (propertyInitializer &&
              (isAttachFunctionReference(propertyInitializer) ||
                (ts.isIdentifier(propertyInitializer) &&
                  markdownAttachFunctionAliases.has(
                    propertyInitializer.text,
                  )))) ||
            (ts.isShorthandPropertyAssignment(property) &&
              markdownAttachFunctionAliases.has(property.name.text))
          ) {
            markdownAttachFunctionPropertyAliases.add(
              `${node.name.text}.${propertyName}`,
            );
          }

          if (
            (propertyInitializer &&
              hasRawMarkdownPayload(propertyInitializer)) ||
            (ts.isShorthandPropertyAssignment(property) &&
              rawMarkdownPayloadAliases.has(property.name.text))
          ) {
            rawMarkdownPayloadPropertyAliases.add(
              `${node.name.text}.${propertyName}`,
            );
          }
        }
      }

      if (ts.isArrayLiteralExpression(initializer)) {
        collectIndexedPropertyAliases(
          node.name.text,
          initializer.elements,
          isMarkdownAttachmentName,
          markdownAttachmentNamePropertyAliases,
        );
        collectIndexedPropertyAliases(
          node.name.text,
          initializer.elements,
          hasRawMarkdownImage,
          rawMarkdownBodyPropertyAliases,
        );
        collectIndexedPropertyAliases(
          node.name.text,
          initializer.elements,
          (element) => {
            const expression = unwrapExpression(element);

            return (
              isAttachFunctionReference(element) ||
              (ts.isIdentifier(expression) &&
                markdownAttachFunctionAliases.has(expression.text))
            );
          },
          markdownAttachFunctionPropertyAliases,
        );
        collectIndexedPropertyAliases(
          node.name.text,
          initializer.elements,
          hasRawMarkdownPayload,
          rawMarkdownPayloadPropertyAliases,
        );
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      hasRawMarkdownImage(node.right)
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
        staticStringAliases,
      );

      if (propertyReference) {
        rawMarkdownBodyPropertyAliases.add(propertyReference);
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      isMarkdownAttachmentName(node.right)
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
        staticStringAliases,
      );

      if (propertyReference) {
        markdownAttachmentNamePropertyAliases.add(propertyReference);
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      isAttachFunctionReference(node.right)
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
        staticStringAliases,
      );

      if (propertyReference) {
        markdownAttachFunctionPropertyAliases.add(propertyReference);
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      hasRawMarkdownPayload(node.right)
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
        staticStringAliases,
      );

      if (propertyReference) {
        rawMarkdownPayloadPropertyAliases.add(propertyReference);
      }
    }

    if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name)) {
      collectBindingInitializerAliases(
        node.name,
        isMarkdownAttachmentName,
        markdownAttachmentNameAliases,
      );
      collectBindingInitializerAliases(
        node.name,
        hasRawMarkdownImage,
        rawMarkdownBodyAliases,
      );
      collectBindingInitializerAliases(
        node.name,
        hasRawMarkdownPayload,
        rawMarkdownPayloadAliases,
      );
      collectObjectRestBindingAliases(
        node,
        hasRawMarkdownPayload,
        rawMarkdownPayloadAliases,
      );
      collectBindingInitializerAliases(
        node.name,
        isTrackedAttachFunctionReference,
        markdownAttachFunctionAliases,
      );
      collectPropertyBindingAliases(
        node.name,
        'attach',
        markdownAttachFunctionAliases,
        staticStringAliases,
      );
      collectObjectRestPropertyAliases(
        node,
        markdownAttachmentNamePropertyAliases,
      );
      collectObjectRestPropertyAliases(node, rawMarkdownBodyPropertyAliases);
      collectObjectRestPropertyAliases(
        node,
        markdownAttachFunctionPropertyAliases,
      );
      collectObjectRestPropertyAliases(node, rawMarkdownPayloadPropertyAliases);
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredPropertyAliases(
        node,
        sourceFile,
        markdownAttachmentNamePropertyAliases,
        markdownAttachmentNameAliases,
        staticStringAliases,
      );
      collectDestructuredPropertyAliases(
        node,
        sourceFile,
        rawMarkdownBodyPropertyAliases,
        rawMarkdownBodyAliases,
        staticStringAliases,
      );
      collectDestructuredPropertyAliases(
        node,
        sourceFile,
        markdownAttachFunctionPropertyAliases,
        markdownAttachFunctionAliases,
        staticStringAliases,
      );
      collectDestructuredPropertyAliases(
        node,
        sourceFile,
        rawMarkdownPayloadPropertyAliases,
        rawMarkdownPayloadAliases,
        staticStringAliases,
      );
    }

    ts.forEachChild(node, collectAliases);
  };

  const hasRawMarkdownAttachmentArguments = (
    nameArgument: ts.Expression | undefined,
    payloadArgument: ts.Expression | undefined,
  ): boolean =>
    !!nameArgument &&
    isMarkdownAttachmentName(nameArgument) &&
    !!payloadArgument &&
    hasRawMarkdownPayload(payloadArgument);

  const hasSpreadArgument = (args: ts.NodeArray<ts.Expression>): boolean =>
    args.some((argument) => ts.isSpreadElement(argument));

  const hasSpreadArrayElement = (
    elements: ts.NodeArray<ts.Expression>,
  ): boolean => elements.some((element) => ts.isSpreadElement(element));

  const isInlineBoundAttachCall = (callee: ts.Expression): boolean => {
    const expression = unwrapExpression(callee);

    if (!ts.isCallExpression(expression)) {
      return false;
    }

    const bindCallee = unwrapExpression(expression.expression);

    if (
      !ts.isPropertyAccessExpression(bindCallee) &&
      !ts.isElementAccessExpression(bindCallee)
    ) {
      return false;
    }

    const receiver = getStaticPropertyReceiver(bindCallee);

    return (
      getStaticPropertyName(bindCallee, staticStringAliases) === 'bind' &&
      !!receiver &&
      isTrackedAttachFunctionReference(receiver)
    );
  };

  const isIndirectRawMarkdownAttachmentCall = (
    callee: ts.Expression,
    args: ts.NodeArray<ts.Expression>,
  ): boolean => {
    if (
      !ts.isPropertyAccessExpression(callee) &&
      !ts.isElementAccessExpression(callee)
    ) {
      return false;
    }

    const methodName = getStaticPropertyName(callee, staticStringAliases);
    const receiver = getStaticPropertyReceiver(callee);

    if (
      !receiver ||
      (methodName !== 'call' && methodName !== 'apply') ||
      !isTrackedAttachFunctionReference(receiver)
    ) {
      return false;
    }

    if (methodName === 'call') {
      return (
        hasSpreadArgument(args) ||
        hasRawMarkdownAttachmentArguments(args[1], args[2])
      );
    }

    const applyArguments = args[1] ? unwrapExpression(args[1]) : null;

    if (!applyArguments || !ts.isArrayLiteralExpression(applyArguments)) {
      return true;
    }

    if (hasSpreadArrayElement(applyArguments.elements)) {
      return true;
    }

    return hasRawMarkdownAttachmentArguments(
      applyArguments.elements[0],
      applyArguments.elements[1],
    );
  };

  const isReflectApplyRawMarkdownAttachmentCall = (
    callee: ts.Expression,
    args: ts.NodeArray<ts.Expression>,
  ): boolean => {
    if (
      !isReflectApplyCallee(callee) ||
      !args[0] ||
      !isTrackedAttachFunctionReference(args[0])
    ) {
      return false;
    }

    const applyArguments = args[2] ? unwrapExpression(args[2]) : null;

    if (!applyArguments || !ts.isArrayLiteralExpression(applyArguments)) {
      return true;
    }

    if (hasSpreadArrayElement(applyArguments.elements)) {
      return true;
    }

    return hasRawMarkdownAttachmentArguments(
      applyArguments.elements[0],
      applyArguments.elements[1],
    );
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);

      if (
        (isTrackedAttachCallCallee(callee) &&
          (hasSpreadArgument(node.arguments) ||
            hasRawMarkdownAttachmentArguments(
              node.arguments[0],
              node.arguments[1],
            ))) ||
        (isInlineBoundAttachCall(callee) &&
          (hasSpreadArgument(node.arguments) ||
            hasRawMarkdownAttachmentArguments(
              node.arguments[0],
              node.arguments[1],
            ))) ||
        isIndirectRawMarkdownAttachmentCall(callee, node.arguments) ||
        isReflectApplyRawMarkdownAttachmentCall(callee, node.arguments)
      ) {
        rawImages.push(describeCall(node));
      }
    }

    ts.forEachChild(node, visit);
  };

  collectAliases(sourceFile);
  visit(sourceFile);

  return rawImages;
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

    if (
      isTrackedArrayTarget(target, isGenericLocatorTarget, {
        emptyArrayIsTracked: true,
        trackedCallbackNames: genericTargetFunctions,
      })
    ) {
      return true;
    }

    if (isTrackedBranchingTarget(target, isGenericLocatorTarget)) {
      return true;
    }

    if (ts.isIdentifier(target)) {
      return genericTargetAliases.has(target.text);
    }

    if (
      ts.isPropertyAccessExpression(target) ||
      ts.isElementAccessExpression(target)
    ) {
      const propertyReference = getStaticPropertyReference(target, sourceFile);
      return propertyReference
        ? genericTargetPropertyAliases.has(propertyReference)
        : false;
    }

    if (ts.isCallExpression(target)) {
      const propertyReference = getStaticArrayMethodReference(
        target,
        sourceFile,
      );

      if (
        propertyReference &&
        genericTargetPropertyAliases.has(propertyReference)
      ) {
        return true;
      }
    }

    if (
      ts.isCallExpression(target) &&
      ts.isIdentifier(target.expression) &&
      genericTargetFunctions.has(target.expression.text)
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
        const selectorText = selector ? getLiteralText(selector) : null;

        if (selectorText) {
          return genericSelectors.has(selectorText.trim().toLowerCase());
        }
      }

      candidate = candidate.expression.expression;
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
      node.initializer &&
      genericTargetFunctions.has(getIdentifierText(node.initializer) ?? '')
    ) {
      genericTargetFunctions.add(node.name.text);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      collectGroupedPropertyAliases(
        node.name.text,
        node.initializer,
        isGenericLocatorTarget,
        genericTargetAliases,
        genericTargetPropertyAliases,
      );
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      isGenericLocatorTarget(unwrapExpression(node.right))
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
      );

      if (propertyReference) {
        genericTargetPropertyAliases.add(propertyReference);
      }
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredPropertyAliases(
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

    if (
      isTrackedArrayTarget(target, isUnfilteredBroadLocatorTarget, {
        trackedCallbackNames: broadTargetFunctions,
      })
    ) {
      return true;
    }

    if (isTrackedBranchingTarget(target, isUnfilteredBroadLocatorTarget)) {
      return true;
    }

    if (ts.isIdentifier(target)) {
      return broadTargetAliases.has(target.text);
    }

    if (
      ts.isPropertyAccessExpression(target) ||
      ts.isElementAccessExpression(target)
    ) {
      const propertyReference = getStaticPropertyReference(target, sourceFile);
      return propertyReference
        ? broadTargetPropertyAliases.has(propertyReference)
        : false;
    }

    if (ts.isCallExpression(target)) {
      const propertyReference = getStaticArrayMethodReference(
        target,
        sourceFile,
      );

      if (
        propertyReference &&
        broadTargetPropertyAliases.has(propertyReference)
      ) {
        return true;
      }
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
        const selectorText = selector ? getLiteralText(selector) : null;

        return !hasFilteringStep && selectorText !== null
          ? isBroadSelector(selectorText)
          : false;
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
      node.initializer &&
      broadTargetFunctions.has(getIdentifierText(node.initializer) ?? '')
    ) {
      broadTargetFunctions.add(node.name.text);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      collectGroupedPropertyAliases(
        node.name.text,
        node.initializer,
        isUnfilteredBroadLocatorTarget,
        broadTargetAliases,
        broadTargetPropertyAliases,
      );
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      isUnfilteredBroadLocatorTarget(unwrapExpression(node.right))
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
      );

      if (propertyReference) {
        broadTargetPropertyAliases.add(propertyReference);
      }
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredPropertyAliases(
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

    if (
      isTrackedArrayTarget(target, isSingleControlLocatorTarget, {
        trackedCallbackNames: singleControlFunctions,
      })
    ) {
      return true;
    }

    if (isTrackedBranchingTarget(target, isSingleControlLocatorTarget)) {
      return true;
    }

    if (ts.isIdentifier(target)) {
      return singleControlAliases.has(target.text);
    }

    if (
      ts.isPropertyAccessExpression(target) ||
      ts.isElementAccessExpression(target)
    ) {
      const propertyReference = getStaticPropertyReference(target, sourceFile);
      return propertyReference
        ? singleControlPropertyAliases.has(propertyReference)
        : false;
    }

    if (ts.isCallExpression(target)) {
      const propertyReference = getStaticArrayMethodReference(
        target,
        sourceFile,
      );

      if (
        propertyReference &&
        singleControlPropertyAliases.has(propertyReference)
      ) {
        return true;
      }
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
      node.initializer &&
      singleControlFunctions.has(getIdentifierText(node.initializer) ?? '')
    ) {
      singleControlFunctions.add(node.name.text);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      collectGroupedPropertyAliases(
        node.name.text,
        node.initializer,
        isSingleControlLocatorTarget,
        singleControlAliases,
        singleControlPropertyAliases,
      );
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      isSingleControlLocatorTarget(unwrapExpression(node.right))
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
      );

      if (propertyReference) {
        singleControlPropertyAliases.add(propertyReference);
      }
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredPropertyAliases(
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

    if (
      isTrackedArrayTarget(target, isIconOrMediaLocatorTarget, {
        trackedCallbackNames: iconOrMediaFunctions,
      })
    ) {
      return true;
    }

    if (isTrackedBranchingTarget(target, isIconOrMediaLocatorTarget)) {
      return true;
    }

    if (ts.isIdentifier(target)) {
      return iconOrMediaAliases.has(target.text);
    }

    if (
      ts.isPropertyAccessExpression(target) ||
      ts.isElementAccessExpression(target)
    ) {
      const propertyReference = getStaticPropertyReference(target, sourceFile);
      return propertyReference
        ? iconOrMediaPropertyAliases.has(propertyReference)
        : false;
    }

    if (ts.isCallExpression(target)) {
      const propertyReference = getStaticArrayMethodReference(
        target,
        sourceFile,
      );

      if (
        propertyReference &&
        iconOrMediaPropertyAliases.has(propertyReference)
      ) {
        return true;
      }
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
      node.initializer &&
      iconOrMediaFunctions.has(getIdentifierText(node.initializer) ?? '')
    ) {
      iconOrMediaFunctions.add(node.name.text);
    }

    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      collectGroupedPropertyAliases(
        node.name.text,
        node.initializer,
        isIconOrMediaLocatorTarget,
        iconOrMediaAliases,
        iconOrMediaPropertyAliases,
      );
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      isIconOrMediaLocatorTarget(unwrapExpression(node.right))
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
      );

      if (propertyReference) {
        iconOrMediaPropertyAliases.add(propertyReference);
      }
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredPropertyAliases(
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
  const staticStringAliases = collectStaticStringAliases(sourceFile);
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

  const isIndirectTakeScreenshotCall = (node: ts.Expression): boolean => {
    if (
      !ts.isPropertyAccessExpression(node) &&
      !ts.isElementAccessExpression(node)
    ) {
      return false;
    }

    const receiver = unwrapExpression(getStaticPropertyReceiver(node) ?? node);
    const propertyName = getStaticPropertyName(node, staticStringAliases);

    return (
      ts.isIdentifier(receiver) &&
      receiver.text === 'takeScreenshot' &&
      (propertyName === 'call' ||
        propertyName === 'apply' ||
        propertyName === 'bind')
    );
  };

  const recordBindingDefaultHelperAliases = (name: ts.BindingName): void => {
    if (ts.isIdentifier(name)) {
      return;
    }

    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) {
        continue;
      }

      if (
        element.initializer &&
        expressionReferencesTakeScreenshot(element.initializer)
      ) {
        bypasses.push(describeNode(element.name));
      }

      recordBindingDefaultHelperAliases(element.name);
    }
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

      if (callee.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0]) {
        const moduleSpecifier = getLiteralText(
          node.arguments[0],
          staticStringAliases,
        );

        if (
          moduleSpecifier ===
            '../../support/reporters/documentation-reporter' ||
          moduleSpecifier?.includes('documentation-reporter/take-screenshot')
        ) {
          bypasses.push(describeNode(node.expression));
        }
      }

      if (
        (ts.isPropertyAccessExpression(callee) ||
          ts.isElementAccessExpression(callee)) &&
        getStaticPropertyName(callee, staticStringAliases) === 'takeScreenshot'
      ) {
        bypasses.push(describeNode(node.expression));
      }

      if (isIndirectTakeScreenshotCall(callee)) {
        bypasses.push(describeNode(node.expression));
      }

      if (
        isReflectApplyCallee(callee) &&
        node.arguments[0] &&
        expressionReferencesTakeScreenshot(node.arguments[0])
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

    if (ts.isParameter(node)) {
      if (
        node.initializer &&
        expressionReferencesTakeScreenshot(node.initializer)
      ) {
        bypasses.push(describeNode(node.name));
      }

      recordBindingDefaultHelperAliases(node.name);
    }

    if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name)) {
      recordBindingDefaultHelperAliases(node.name);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      expressionReferencesTakeScreenshot(node.right)
    ) {
      bypasses.push(describeNode(node.left));
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
  const staticStringAliases = collectStaticStringAliases(sourceFile);
  const imageAttachments: string[] = [];
  const imageAttachmentNameAliases = new Set<string>();
  const imageAttachmentNamePropertyAliases = new Set<string>();
  const imageAttachmentPayloadAliases = new Set<string>();
  const imageAttachmentPayloadPropertyAliases = new Set<string>();
  const imageAttachmentPayloadValueAliases = new Set<string>();
  const imageAttachmentPayloadValuePropertyAliases = new Set<string>();
  const attachFunctionAliases = new Set<string>();
  const attachFunctionPropertyAliases = new Set<string>();

  const describeCall = (node: ts.CallExpression): string => {
    const position = sourceFile.getLineAndCharacterOfPosition(
      node.expression.getStart(sourceFile),
    );
    return `${path}:${position.line + 1}:${position.character + 1}`;
  };

  const getStringLiteralText = (node: ts.Expression): null | string => {
    return getLiteralText(node, staticStringAliases);
  };

  const getStaticStringValue = (node: ts.Expression): null | string => {
    const expression = unwrapExpression(node);
    const literalText = getStringLiteralText(expression);

    if (literalText !== null) {
      return literalText;
    }

    if (
      ts.isBinaryExpression(expression) &&
      expression.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      const left = getStaticStringValue(expression.left);
      const right = getStaticStringValue(expression.right);

      return left !== null && right !== null ? `${left}${right}` : null;
    }

    return null;
  };

  const hasPropertyAlias = (
    node: ts.Expression,
    propertyAliases: ReadonlySet<string>,
  ): boolean => {
    const expression = unwrapExpression(node);
    const propertyReference =
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)
        ? getStaticPropertyReference(
            expression,
            sourceFile,
            staticStringAliases,
          )
        : ts.isCallExpression(expression)
          ? getStaticArrayMethodReference(
              expression,
              sourceFile,
              staticStringAliases,
            )
          : null;

    return propertyReference ? propertyAliases.has(propertyReference) : false;
  };

  const isImageAttachmentName = (node: ts.Expression): boolean => {
    const expression = unwrapExpression(node);
    const staticStringValue = getStaticStringValue(expression);

    if (staticStringValue !== null) {
      return staticStringValue === 'image';
    }

    if (hasPropertyAlias(expression, imageAttachmentNamePropertyAliases)) {
      return true;
    }

    if (ts.isCallExpression(expression)) {
      return expression.arguments.some((argument) =>
        isImageAttachmentName(argument),
      );
    }

    if (ts.isTemplateExpression(expression)) {
      return expression.templateSpans.some((span) =>
        isImageAttachmentName(span.expression),
      );
    }

    if (ts.isConditionalExpression(expression)) {
      return (
        isImageAttachmentName(expression.whenTrue) ||
        isImageAttachmentName(expression.whenFalse)
      );
    }

    if (
      ts.isBinaryExpression(expression) &&
      [
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.QuestionQuestionToken,
      ].includes(expression.operatorToken.kind)
    ) {
      return (
        isImageAttachmentName(expression.left) ||
        isImageAttachmentName(expression.right)
      );
    }

    if (ts.isIdentifier(expression)) {
      return imageAttachmentNameAliases.has(expression.text);
    }

    return false;
  };

  const isImageAttachmentPayloadValue = (node: ts.Expression): boolean => {
    const value = unwrapExpression(node);

    if (hasPropertyAlias(value, imageAttachmentPayloadValuePropertyAliases)) {
      return true;
    }

    if (ts.isCallExpression(value)) {
      return value.arguments.some((argument) =>
        isImageAttachmentPayloadValue(argument),
      );
    }

    if (ts.isTemplateExpression(value)) {
      return value.templateSpans.some((span) =>
        isImageAttachmentPayloadValue(span.expression),
      );
    }

    if (ts.isConditionalExpression(value)) {
      return (
        isImageAttachmentPayloadValue(value.whenTrue) ||
        isImageAttachmentPayloadValue(value.whenFalse)
      );
    }

    if (
      ts.isBinaryExpression(value) &&
      [
        ts.SyntaxKind.BarBarToken,
        ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.QuestionQuestionToken,
        ts.SyntaxKind.PlusToken,
      ].includes(value.operatorToken.kind)
    ) {
      return (
        isImageAttachmentPayloadValue(value.left) ||
        isImageAttachmentPayloadValue(value.right)
      );
    }

    if (ts.isIdentifier(value)) {
      return imageAttachmentPayloadValueAliases.has(value.text);
    }

    const propertyValue = getStringLiteralText(value);

    if (!propertyValue) {
      return false;
    }

    const normalizedValue = propertyValue.trim().toLowerCase();

    return (
      normalizedValue.startsWith('image/') ||
      /\.(?:avif|gif|jpe?g|png|webp)$/iu.test(normalizedValue)
    );
  };

  const isImageAttachmentPayload = (node: ts.Expression): boolean => {
    const payload = unwrapExpression(node);

    if (ts.isIdentifier(payload)) {
      return imageAttachmentPayloadAliases.has(payload.text);
    }

    if (isStaticObjectAssignCall(payload, staticStringAliases)) {
      return payload.arguments.some((argument) =>
        isImageAttachmentPayload(argument),
      );
    }

    if (hasPropertyAlias(payload, imageAttachmentPayloadPropertyAliases)) {
      return true;
    }

    if (!ts.isObjectLiteralExpression(payload)) {
      return false;
    }

    return payload.properties.some((property) => {
      if (ts.isSpreadAssignment(property)) {
        return isImageAttachmentPayload(property.expression);
      }

      if (
        ts.isShorthandPropertyAssignment(property) &&
        (property.name.text === 'contentType' || property.name.text === 'path')
      ) {
        return imageAttachmentPayloadValueAliases.has(property.name.text);
      }

      if (!ts.isPropertyAssignment(property)) {
        return false;
      }

      const propertyName = getStaticPropertyNameFromName(
        property.name,
        staticStringAliases,
      );

      if (propertyName !== 'contentType' && propertyName !== 'path') {
        return false;
      }

      if (!isImageAttachmentPayloadValue(property.initializer)) {
        return false;
      }

      return true;
    });
  };

  const isAttachFunctionReference = (node: ts.Expression): boolean => {
    const expression = unwrapExpression(node);

    if (
      (ts.isPropertyAccessExpression(expression) ||
        ts.isElementAccessExpression(expression)) &&
      getStaticPropertyName(expression, staticStringAliases) === 'attach'
    ) {
      return true;
    }

    if (
      ts.isCallExpression(expression) &&
      getStaticPropertyName(expression.expression, staticStringAliases) ===
        'bind' &&
      getStaticPropertyName(
        getStaticPropertyReceiver(expression.expression) ??
          expression.expression,
        staticStringAliases,
      ) === 'attach'
    ) {
      return true;
    }

    return false;
  };

  const isTrackedAttachFunctionReference = (node: ts.Expression): boolean => {
    const expression = unwrapExpression(node);

    if (isAttachFunctionReference(expression)) {
      return true;
    }

    if (ts.isIdentifier(expression)) {
      return attachFunctionAliases.has(expression.text);
    }

    if (hasPropertyAlias(expression, attachFunctionPropertyAliases)) {
      return true;
    }

    return false;
  };

  const addAttachBindingAliases = (name: ts.BindingName): void => {
    addBindingIdentifiers(name, attachFunctionAliases);
  };

  const collectAliasValuesAndAttachFunctions = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      if (getStringLiteralText(node.initializer) === 'image') {
        imageAttachmentNameAliases.add(node.name.text);
      }

      if (isImageAttachmentPayloadValue(node.initializer)) {
        imageAttachmentPayloadValueAliases.add(node.name.text);
      }

      if (isAttachFunctionReference(node.initializer)) {
        attachFunctionAliases.add(node.name.text);
      }

      const objectInitializer = unwrapExpression(node.initializer);

      if (ts.isObjectLiteralExpression(objectInitializer)) {
        for (const property of objectInitializer.properties) {
          const initializer = ts.isPropertyAssignment(property)
            ? unwrapExpression(property.initializer)
            : null;

          if (
            ts.isPropertyAssignment(property) &&
            (isAttachFunctionReference(property.initializer) ||
              (initializer &&
                ts.isIdentifier(initializer) &&
                attachFunctionAliases.has(initializer.text)))
          ) {
            const propertyName = getStaticPropertyNameFromName(
              property.name,
              staticStringAliases,
            );

            if (propertyName) {
              attachFunctionPropertyAliases.add(
                `${node.name.text}.${propertyName}`,
              );
            }
          }

          if (
            ts.isShorthandPropertyAssignment(property) &&
            attachFunctionAliases.has(property.name.text)
          ) {
            attachFunctionPropertyAliases.add(
              `${node.name.text}.${property.name.text}`,
            );
          }

          if (
            ts.isPropertyAssignment(property) &&
            isImageAttachmentName(property.initializer)
          ) {
            const propertyName = getStaticPropertyNameFromName(
              property.name,
              staticStringAliases,
            );

            if (propertyName) {
              imageAttachmentNamePropertyAliases.add(
                `${node.name.text}.${propertyName}`,
              );
            }
          }

          if (
            ts.isShorthandPropertyAssignment(property) &&
            imageAttachmentNameAliases.has(property.name.text)
          ) {
            imageAttachmentNamePropertyAliases.add(
              `${node.name.text}.${property.name.text}`,
            );
          }

          if (
            ts.isPropertyAssignment(property) &&
            isImageAttachmentPayloadValue(property.initializer)
          ) {
            const propertyName = getStaticPropertyNameFromName(
              property.name,
              staticStringAliases,
            );

            if (propertyName) {
              imageAttachmentPayloadValuePropertyAliases.add(
                `${node.name.text}.${propertyName}`,
              );
            }
          }

          if (
            ts.isShorthandPropertyAssignment(property) &&
            imageAttachmentPayloadValueAliases.has(property.name.text)
          ) {
            imageAttachmentPayloadValuePropertyAliases.add(
              `${node.name.text}.${property.name.text}`,
            );
          }
        }
      }

      if (ts.isArrayLiteralExpression(objectInitializer)) {
        collectIndexedPropertyAliases(
          node.name.text,
          objectInitializer.elements,
          (element) => {
            const expression = unwrapExpression(element);

            return (
              isAttachFunctionReference(element) ||
              (ts.isIdentifier(expression) &&
                attachFunctionAliases.has(expression.text))
            );
          },
          attachFunctionPropertyAliases,
        );
        collectIndexedPropertyAliases(
          node.name.text,
          objectInitializer.elements,
          isImageAttachmentName,
          imageAttachmentNamePropertyAliases,
        );
        collectIndexedPropertyAliases(
          node.name.text,
          objectInitializer.elements,
          isImageAttachmentPayloadValue,
          imageAttachmentPayloadValuePropertyAliases,
        );
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      isImageAttachmentName(node.right)
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
        staticStringAliases,
      );

      if (propertyReference) {
        imageAttachmentNamePropertyAliases.add(propertyReference);
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      isImageAttachmentPayloadValue(node.right)
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
        staticStringAliases,
      );

      if (propertyReference) {
        imageAttachmentPayloadValuePropertyAliases.add(propertyReference);
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      isAttachFunctionReference(node.right)
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
        staticStringAliases,
      );

      if (propertyReference) {
        attachFunctionPropertyAliases.add(propertyReference);
      }
    }

    if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name)) {
      collectBindingInitializerAliases(
        node.name,
        isImageAttachmentName,
        imageAttachmentNameAliases,
      );
      collectBindingInitializerAliases(
        node.name,
        isImageAttachmentPayloadValue,
        imageAttachmentPayloadValueAliases,
      );
      collectBindingInitializerAliases(
        node.name,
        isImageAttachmentPayload,
        imageAttachmentPayloadAliases,
      );
      collectBindingInitializerAliases(
        node.name,
        isTrackedAttachFunctionReference,
        attachFunctionAliases,
      );
      collectPropertyBindingAliases(
        node.name,
        'attach',
        attachFunctionAliases,
        staticStringAliases,
      );
      collectObjectRestPropertyAliases(
        node,
        imageAttachmentNamePropertyAliases,
      );
      collectObjectRestPropertyAliases(
        node,
        imageAttachmentPayloadValuePropertyAliases,
      );
      collectObjectRestPropertyAliases(node, attachFunctionPropertyAliases);
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredPropertyAliases(
        node,
        sourceFile,
        imageAttachmentNamePropertyAliases,
        imageAttachmentNameAliases,
        staticStringAliases,
      );
      collectDestructuredPropertyAliases(
        node,
        sourceFile,
        imageAttachmentPayloadValuePropertyAliases,
        imageAttachmentPayloadValueAliases,
        staticStringAliases,
      );
      collectDestructuredPropertyAliases(
        node,
        sourceFile,
        attachFunctionPropertyAliases,
        attachFunctionAliases,
        staticStringAliases,
      );
    }

    ts.forEachChild(node, collectAliasValuesAndAttachFunctions);
  };

  const collectPayloadAliases = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      isImageAttachmentPayload(node.initializer)
    ) {
      imageAttachmentPayloadAliases.add(node.name.text);
    }

    if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name)) {
      collectObjectRestBindingAliases(
        node,
        isImageAttachmentPayload,
        imageAttachmentPayloadAliases,
      );
    }

    ts.forEachChild(node, collectPayloadAliases);
  };

  const collectPayloadPropertyAliases = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const objectInitializer = unwrapExpression(node.initializer);

      if (ts.isObjectLiteralExpression(objectInitializer)) {
        for (const property of objectInitializer.properties) {
          const propertyName = getStaticPropertyNameFromName(
            property.name,
            staticStringAliases,
          );

          if (!propertyName) {
            continue;
          }

          if (
            (ts.isPropertyAssignment(property) &&
              isImageAttachmentPayload(property.initializer)) ||
            (ts.isShorthandPropertyAssignment(property) &&
              imageAttachmentPayloadAliases.has(property.name.text))
          ) {
            imageAttachmentPayloadPropertyAliases.add(
              `${node.name.text}.${propertyName}`,
            );
          }
        }
      }

      if (ts.isArrayLiteralExpression(objectInitializer)) {
        collectIndexedPropertyAliases(
          node.name.text,
          objectInitializer.elements,
          isImageAttachmentPayload,
          imageAttachmentPayloadPropertyAliases,
        );
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      isImageAttachmentPayload(node.right)
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
        staticStringAliases,
      );

      if (propertyReference) {
        imageAttachmentPayloadPropertyAliases.add(propertyReference);
      }
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredPropertyAliases(
        node,
        sourceFile,
        imageAttachmentPayloadPropertyAliases,
        imageAttachmentPayloadAliases,
        staticStringAliases,
      );
      collectObjectRestPropertyAliases(
        node,
        imageAttachmentPayloadPropertyAliases,
      );
    }

    ts.forEachChild(node, collectPayloadPropertyAliases);
  };

  const hasImageAttachmentArguments = (
    nameArgument: ts.Expression | undefined,
    payloadArgument: ts.Expression | undefined,
  ): boolean =>
    !!nameArgument &&
    (isImageAttachmentName(nameArgument) ||
      (!!payloadArgument && isImageAttachmentPayload(payloadArgument)));

  const hasSpreadArgument = (args: ts.NodeArray<ts.Expression>): boolean =>
    args.some((argument) => ts.isSpreadElement(argument));

  const hasSpreadArrayElement = (
    elements: ts.NodeArray<ts.Expression>,
  ): boolean => elements.some((element) => ts.isSpreadElement(element));

  const isTrackedAttachCallCallee = (callee: ts.Expression): boolean =>
    isTrackedAttachFunctionReference(callee) ||
    isTrackedBranchingTarget(callee, isTrackedAttachFunctionReference);

  const isInlineBoundAttachCall = (callee: ts.Expression): boolean => {
    const expression = unwrapExpression(callee);

    if (!ts.isCallExpression(expression)) {
      return false;
    }

    const bindCallee = unwrapExpression(expression.expression);

    if (
      !ts.isPropertyAccessExpression(bindCallee) &&
      !ts.isElementAccessExpression(bindCallee)
    ) {
      return false;
    }

    const receiver = getStaticPropertyReceiver(bindCallee);

    return (
      getStaticPropertyName(bindCallee, staticStringAliases) === 'bind' &&
      !!receiver &&
      isTrackedAttachFunctionReference(receiver)
    );
  };

  const isIndirectImageAttachmentCall = (
    callee: ts.Expression,
    args: ts.NodeArray<ts.Expression>,
  ): boolean => {
    if (
      !ts.isPropertyAccessExpression(callee) &&
      !ts.isElementAccessExpression(callee)
    ) {
      return false;
    }

    const methodName = getStaticPropertyName(callee, staticStringAliases);
    const receiver = getStaticPropertyReceiver(callee);

    if (
      !receiver ||
      (methodName !== 'call' && methodName !== 'apply') ||
      !isTrackedAttachFunctionReference(receiver)
    ) {
      return false;
    }

    if (methodName === 'call') {
      return (
        hasSpreadArgument(args) || hasImageAttachmentArguments(args[1], args[2])
      );
    }

    const applyArguments = args[1] ? unwrapExpression(args[1]) : null;

    if (!applyArguments || !ts.isArrayLiteralExpression(applyArguments)) {
      return true;
    }

    if (hasSpreadArrayElement(applyArguments.elements)) {
      return true;
    }

    return hasImageAttachmentArguments(
      applyArguments.elements[0],
      applyArguments.elements[1],
    );
  };

  const isReflectApplyImageAttachmentCall = (
    callee: ts.Expression,
    args: ts.NodeArray<ts.Expression>,
  ): boolean => {
    if (
      !isReflectApplyCallee(callee) ||
      !args[0] ||
      !isTrackedAttachFunctionReference(args[0])
    ) {
      return false;
    }

    const applyArguments = args[2] ? unwrapExpression(args[2]) : null;

    if (!applyArguments || !ts.isArrayLiteralExpression(applyArguments)) {
      return true;
    }

    if (hasSpreadArrayElement(applyArguments.elements)) {
      return true;
    }

    return hasImageAttachmentArguments(
      applyArguments.elements[0],
      applyArguments.elements[1],
    );
  };

  const inspectImageAttachmentCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);

      if (
        (isTrackedAttachCallCallee(callee) &&
          (hasSpreadArgument(node.arguments) ||
            hasImageAttachmentArguments(
              node.arguments[0],
              node.arguments[1],
            ))) ||
        (isInlineBoundAttachCall(callee) &&
          (hasSpreadArgument(node.arguments) ||
            hasImageAttachmentArguments(
              node.arguments[0],
              node.arguments[1],
            ))) ||
        isIndirectImageAttachmentCall(callee, node.arguments) ||
        isReflectApplyImageAttachmentCall(callee, node.arguments)
      ) {
        imageAttachments.push(describeCall(node));
      }
    }

    ts.forEachChild(node, inspectImageAttachmentCalls);
  };

  collectAliasValuesAndAttachFunctions(sourceFile);
  collectPayloadAliases(sourceFile);
  collectPayloadPropertyAliases(sourceFile);
  inspectImageAttachmentCalls(sourceFile);

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
  const staticStringAliases = collectStaticStringAliases(sourceFile);
  const screenshotCalls: string[] = [];
  const screenshotFunctionAliases = new Set<string>();
  const screenshotFunctionPropertyAliases = new Set<string>();

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
      getStaticPropertyName(expression, staticStringAliases) === 'screenshot'
    ) {
      return true;
    }

    if (
      ts.isCallExpression(expression) &&
      getStaticPropertyName(expression.expression, staticStringAliases) ===
        'bind' &&
      getStaticPropertyName(
        getStaticPropertyReceiver(expression.expression) ??
          expression.expression,
        staticStringAliases,
      ) === 'screenshot'
    ) {
      return true;
    }

    return false;
  };

  const isScreenshotFunctionPropertyAlias = (node: ts.Expression): boolean => {
    const expression = unwrapExpression(node);
    const propertyReference =
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)
        ? getStaticPropertyReference(
            expression,
            sourceFile,
            staticStringAliases,
          )
        : ts.isCallExpression(expression)
          ? getStaticArrayMethodReference(
              expression,
              sourceFile,
              staticStringAliases,
            )
          : null;

    return propertyReference
      ? screenshotFunctionPropertyAliases.has(propertyReference)
      : false;
  };

  const isTrackedScreenshotFunctionReference = (
    node: ts.Expression,
  ): boolean => {
    const expression = unwrapExpression(node);

    if (isScreenshotFunctionReference(expression)) {
      return true;
    }

    if (ts.isIdentifier(expression)) {
      return screenshotFunctionAliases.has(expression.text);
    }

    if (isScreenshotFunctionPropertyAlias(expression)) {
      return true;
    }

    return false;
  };

  const addScreenshotBindingAliases = (name: ts.BindingName): void => {
    addBindingIdentifiers(name, screenshotFunctionAliases);
  };

  const isInlineBoundScreenshotCall = (callee: ts.Expression): boolean => {
    const expression = unwrapExpression(callee);

    if (!ts.isCallExpression(expression)) {
      return false;
    }

    const bindCallee = unwrapExpression(expression.expression);

    if (
      !ts.isPropertyAccessExpression(bindCallee) &&
      !ts.isElementAccessExpression(bindCallee)
    ) {
      return false;
    }

    const receiver = getStaticPropertyReceiver(bindCallee);

    return (
      getStaticPropertyName(bindCallee, staticStringAliases) === 'bind' &&
      !!receiver &&
      isTrackedScreenshotFunctionReference(receiver)
    );
  };

  const isTrackedScreenshotCallCallee = (callee: ts.Expression): boolean =>
    isTrackedScreenshotFunctionReference(callee) ||
    isTrackedBranchingTarget(callee, isTrackedScreenshotFunctionReference);

  const collectAliases = (node: ts.Node): void => {
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
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const objectInitializer = unwrapExpression(node.initializer);

      if (ts.isObjectLiteralExpression(objectInitializer)) {
        for (const property of objectInitializer.properties) {
          const initializer = ts.isPropertyAssignment(property)
            ? unwrapExpression(property.initializer)
            : null;

          if (
            ts.isPropertyAssignment(property) &&
            (isScreenshotFunctionReference(property.initializer) ||
              (initializer &&
                ts.isIdentifier(initializer) &&
                screenshotFunctionAliases.has(initializer.text)))
          ) {
            const propertyName = getStaticPropertyNameFromName(
              property.name,
              staticStringAliases,
            );

            if (propertyName) {
              screenshotFunctionPropertyAliases.add(
                `${node.name.text}.${propertyName}`,
              );
            }
          }

          if (
            ts.isShorthandPropertyAssignment(property) &&
            screenshotFunctionAliases.has(property.name.text)
          ) {
            screenshotFunctionPropertyAliases.add(
              `${node.name.text}.${property.name.text}`,
            );
          }
        }
      }

      if (ts.isArrayLiteralExpression(objectInitializer)) {
        collectIndexedPropertyAliases(
          node.name.text,
          objectInitializer.elements,
          (element) => {
            const expression = unwrapExpression(element);

            return (
              isScreenshotFunctionReference(element) ||
              (ts.isIdentifier(expression) &&
                screenshotFunctionAliases.has(expression.text))
            );
          },
          screenshotFunctionPropertyAliases,
        );
      }
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      (ts.isPropertyAccessExpression(node.left) ||
        ts.isElementAccessExpression(node.left)) &&
      isScreenshotFunctionReference(node.right)
    ) {
      const propertyReference = getStaticPropertyReference(
        node.left,
        sourceFile,
        staticStringAliases,
      );

      if (propertyReference) {
        screenshotFunctionPropertyAliases.add(propertyReference);
      }
    }

    if (ts.isVariableDeclaration(node) && !ts.isIdentifier(node.name)) {
      collectBindingInitializerAliases(
        node.name,
        isTrackedScreenshotFunctionReference,
        screenshotFunctionAliases,
      );
      collectPropertyBindingAliases(
        node.name,
        'screenshot',
        screenshotFunctionAliases,
        staticStringAliases,
      );
    }

    if (ts.isVariableDeclaration(node)) {
      collectDestructuredPropertyAliases(
        node,
        sourceFile,
        screenshotFunctionPropertyAliases,
        screenshotFunctionAliases,
        staticStringAliases,
      );
    }

    ts.forEachChild(node, collectAliases);
  };

  const inspectScreenshotCalls = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = unwrapExpression(node.expression);
      const receiver =
        ts.isPropertyAccessExpression(callee) ||
        ts.isElementAccessExpression(callee)
          ? getStaticPropertyReceiver(callee)
          : null;
      const isIndirectScreenshotCall =
        !!receiver &&
        (getStaticPropertyName(callee, staticStringAliases) === 'call' ||
          getStaticPropertyName(callee, staticStringAliases) === 'apply') &&
        isTrackedScreenshotFunctionReference(receiver);
      const isReflectApplyScreenshotCall =
        isReflectApplyCallee(callee) &&
        !!node.arguments[0] &&
        isTrackedScreenshotFunctionReference(node.arguments[0]);

      if (
        isTrackedScreenshotCallCallee(callee) ||
        isInlineBoundScreenshotCall(callee) ||
        isIndirectScreenshotCall ||
        isReflectApplyScreenshotCall
      ) {
        screenshotCalls.push(describeCall(node));
      }
    }

    ts.forEachChild(node, inspectScreenshotCalls);
  };

  collectAliases(sourceFile);
  inspectScreenshotCalls(sourceFile);

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

      const helperAssignments = {};
      helperAssignments.capture = takeScreenshot;
      helperAssignments['computedCapture'] = takeScreenshot;
      const helperList = [];
      helperList[0] = takeScreenshot;
      const { captureDefault = takeScreenshot } = {};
      const [listedCaptureDefault = takeScreenshot] = [];
      async function renderEvidence(captureParameter = takeScreenshot) {
        return captureParameter;
      }
      async function renderGroupedEvidence({ capture = takeScreenshot } = {}) {
        return capture;
      }

      async function dynamicImportBypass() {
        const dynamicReporter = await import('../../support/reporters/documentation-reporter');
        const dynamicDirectHelper = await import('../../support/reporters/documentation-reporter/take-screenshot');
        const templateLiteralReporter = await import(\`../../support/reporters/documentation-reporter\`);
        const templateLiteralDirectHelper = await import(\`../../support/reporters/documentation-reporter/take-screenshot\`);
        return [
          dynamicReporter,
          dynamicDirectHelper,
          templateLiteralReporter,
          templateLiteralDirectHelper,
        ];
      }

      await takeScreenshot.call(
        undefined,
        testInfo,
        settingsSurface,
        page,
        'Indirect call helper bypass with descriptive caption',
      );
      await takeScreenshot['apply'](undefined, [
        testInfo,
        settingsSurface,
        page,
        'Indirect apply helper bypass with descriptive caption',
      ]);
      await takeScreenshot.bind(undefined)(
        testInfo,
        settingsSurface,
        page,
        'Indirect bind helper bypass with descriptive caption',
      );
      await Reflect.apply(takeScreenshot, undefined, [
        testInfo,
        settingsSurface,
        page,
        'Reflect apply helper bypass with descriptive caption',
      ]);
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
      'tests/docs/example/bypass.doc.ts:38:7',
      'tests/docs/example/bypass.doc.ts:39:7',
      'tests/docs/example/bypass.doc.ts:41:7',
      'tests/docs/example/bypass.doc.ts:42:15',
      'tests/docs/example/bypass.doc.ts:43:14',
      'tests/docs/example/bypass.doc.ts:44:37',
      'tests/docs/example/bypass.doc.ts:47:46',
      'tests/docs/example/bypass.doc.ts:52:39',
      'tests/docs/example/bypass.doc.ts:53:43',
      'tests/docs/example/bypass.doc.ts:54:47',
      'tests/docs/example/bypass.doc.ts:55:51',
      'tests/docs/example/bypass.doc.ts:64:13',
      'tests/docs/example/bypass.doc.ts:71:13',
      'tests/docs/example/bypass.doc.ts:77:13',
      'tests/docs/example/bypass.doc.ts:83:13',
    ]);
  });

  it('detects direct image attachments before generated docs can use them', () => {
    const directImageAttachmentSource = `
      await testInfo.attach('image', { body: imageBuffer });
      await testInfo.attach(\`image\`, { body: imageBuffer });
      const attachmentName = 'image';
      await testInfo.attach(attachmentName, { body: imageBuffer });
      const stringWrappedAttachmentName = String(attachmentName);
      const interpolatedAttachmentName = \`\${attachmentName}\`;
      const conditionalAttachmentName = useImageName ? attachmentName : 'trace';
      const nullishAttachmentName = fallbackAttachmentName ?? attachmentName;
      const logicalAttachmentName = fallbackAttachmentName || attachmentName;
      const concatenatedAttachmentName = 'im' + 'age';
      await testInfo.attach(stringWrappedAttachmentName, { body: imageBuffer });
      await testInfo.attach(interpolatedAttachmentName, { body: imageBuffer });
      await testInfo.attach(conditionalAttachmentName, { body: imageBuffer });
      await testInfo.attach(nullishAttachmentName, { body: imageBuffer });
      await testInfo.attach(logicalAttachmentName, { body: imageBuffer });
      await testInfo.attach(concatenatedAttachmentName, { body: imageBuffer });
      const attachmentNames = {
        evidence: 'image',
        ['computedEvidence']: 'image',
        attachmentName,
      };
      await testInfo.attach(attachmentNames.evidence, { body: imageBuffer });
      await testInfo.attach(attachmentNames['computedEvidence'], { body: imageBuffer });
      await testInfo.attach(attachmentNames.attachmentName, { body: imageBuffer });
      const { evidence: groupedAttachmentName } = attachmentNames;
      await testInfo.attach(groupedAttachmentName, { body: imageBuffer });
      const attachmentNameList = ['image', attachmentName];
      await testInfo.attach(attachmentNameList[0], { body: imageBuffer });
      await testInfo.attach(attachmentNameList[1], { body: imageBuffer });
      attachmentNames.assignedEvidence = 'image';
      await testInfo.attach(attachmentNames.assignedEvidence, { body: imageBuffer });
      const attachEvidence = testInfo.attach.bind(testInfo);
      await attachEvidence('image', { body: imageBuffer });
      const attachEvidenceByElement = testInfo['attach'].bind(testInfo);
      await attachEvidenceByElement('image', { body: imageBuffer });
      const { attach: attachImageDirectly } = testInfo;
      await attachImageDirectly('image', { body: imageBuffer });
      const [{ attach: nestedAttachImageDirectly }] = [testInfo];
      await nestedAttachImageDirectly('image', { body: imageBuffer });
      await testInfo['attach']('image', { body: imageBuffer });
      await testInfo.attach('raw evidence', { body: imageBuffer, contentType: 'image/png' });
      await testInfo.attach('raw file evidence', { path: 'raw-evidence.webp' });
      const rawImagePayload = { body: imageBuffer, contentType: 'image/jpeg' };
      await testInfo.attach('aliased raw evidence', rawImagePayload);
      const rawImagePathPayload = { path: 'aliased-raw-evidence.png' };
      await testInfo.attach('aliased raw file evidence', rawImagePathPayload);
      const imageMime = 'image/webp';
      await testInfo.attach('aliased mime evidence', { body: imageBuffer, contentType: imageMime });
      const contentType = 'image/gif';
      await testInfo.attach('shorthand mime evidence', { body: imageBuffer, contentType });
      const imagePath = 'aliased-image-path.jpeg';
      await testInfo.attach('aliased path evidence', { path: imagePath });
      const stringWrappedMimePayload = { body: imageBuffer, contentType: String(imageMime) };
      const interpolatedPathPayload = { path: \`\${imagePath}\` };
      const conditionalMimePayload = {
        body: imageBuffer,
        contentType: useImageMime ? imageMime : 'text/plain',
      };
      const nullishPathPayload = { path: fallbackImagePath ?? imagePath };
      const logicalMimePayload = { body: imageBuffer, contentType: fallbackMime || imageMime };
      const concatenatedPathPayload = { path: 'evidence-' + imagePath };
      await testInfo.attach('string wrapped mime evidence', {
        body: imageBuffer,
        contentType: String(imageMime),
      });
      await testInfo.attach('interpolated path evidence', {
        path: \`\${imagePath}\`,
      });
      await testInfo.attach('conditional mime evidence', {
        body: imageBuffer,
        contentType: useImageMime ? imageMime : 'text/plain',
      });
      await testInfo.attach('nullish path evidence', {
        path: fallbackImagePath ?? imagePath,
      });
      await testInfo.attach('logical mime evidence', {
        body: imageBuffer,
        contentType: fallbackMime || imageMime,
      });
      await testInfo.attach('concatenated path evidence', {
        path: 'evidence-' + imagePath,
      });
      await testInfo.attach('string wrapped payload evidence', stringWrappedMimePayload);
      await testInfo.attach('interpolated path payload evidence', interpolatedPathPayload);
      await testInfo.attach('conditional mime payload evidence', conditionalMimePayload);
      await testInfo.attach('nullish path payload evidence', nullishPathPayload);
      await testInfo.attach('logical mime payload evidence', logicalMimePayload);
      await testInfo.attach('concatenated path payload evidence', concatenatedPathPayload);
      const rawImageValues = {
        mime: 'image/avif',
        ['computedMime']: 'image/png',
        imageMime,
        imagePath,
      };
      await testInfo.attach('grouped raw mime evidence', { body: imageBuffer, contentType: rawImageValues.mime });
      await testInfo.attach('computed grouped raw mime evidence', { body: imageBuffer, contentType: rawImageValues['computedMime'] });
      await testInfo.attach('alias-valued grouped raw mime evidence', { body: imageBuffer, contentType: rawImageValues.imageMime });
      await testInfo.attach('alias-valued grouped raw path evidence', { path: rawImageValues.imagePath });
      const { mime: groupedImageMime } = rawImageValues;
      await testInfo.attach('destructured grouped raw mime evidence', { body: imageBuffer, contentType: groupedImageMime });
      const rawImageValueList = ['image/jpeg', imagePath];
      await testInfo.attach('listed raw mime evidence', { body: imageBuffer, contentType: rawImageValueList[0] });
      await testInfo.attach('listed raw path evidence', { path: rawImageValueList[1] });
      rawImageValues.assignedPath = 'assigned-raw-evidence.webp';
      await testInfo.attach('assigned grouped raw path evidence', { path: rawImageValues.assignedPath });
      await forwardAttachEvidence('image', { body: imageBuffer });
      await testInfo.attach(forwardAttachmentName, { body: imageBuffer });
      await testInfo.attach('forward raw evidence', forwardRawImagePayload);
      await testInfo.attach('computed raw evidence', { body: imageBuffer, ['contentType']: 'image/png' });
      const computedRawPayload = { ['path']: 'computed-raw-evidence.png' };
      await testInfo.attach('computed raw file evidence', computedRawPayload);
      const rawImagePayloads = {
        evidence: rawImagePayload,
        ['computedEvidence']: computedRawPayload,
        rawImagePathPayload,
      };
      await testInfo.attach('grouped raw payload evidence', rawImagePayloads.evidence);
      await testInfo.attach('computed grouped raw payload evidence', rawImagePayloads['computedEvidence']);
      await testInfo.attach('shorthand grouped raw payload evidence', rawImagePayloads.rawImagePathPayload);
      const { evidence: groupedRawImagePayload } = rawImagePayloads;
      await testInfo.attach('destructured grouped raw payload evidence', groupedRawImagePayload);
      const rawImagePayloadList = [rawImagePayload, computedRawPayload];
      await testInfo.attach('indexed raw payload evidence', rawImagePayloadList[0]);
      await testInfo.attach('second indexed raw payload evidence', rawImagePayloadList[1]);
      rawImagePayloads.assignedEvidence = rawImagePathPayload;
      await testInfo.attach('assigned grouped raw payload evidence', rawImagePayloads.assignedEvidence);
      const attachHelpers = {
        evidence: testInfo.attach.bind(testInfo),
        ['computedEvidence']: testInfo.attach.bind(testInfo),
        attachEvidence,
        evidenceFromAlias: attachEvidenceByElement,
      };
      await attachHelpers.evidence('image', { body: imageBuffer });
      await attachHelpers['computedEvidence']('image', { body: imageBuffer });
      await attachHelpers.attachEvidence('image', { body: imageBuffer });
      await attachHelpers.evidenceFromAlias('image', { body: imageBuffer });
      const { evidence: destructuredAttachEvidence } = attachHelpers;
      await destructuredAttachEvidence('image', { body: imageBuffer });
      const [{ evidence: nestedDestructuredAttachEvidence }] = [attachHelpers];
      await nestedDestructuredAttachEvidence('image', { body: imageBuffer });
      attachHelpers.assignedEvidence = testInfo.attach.bind(testInfo);
      await attachHelpers.assignedEvidence('image', { body: imageBuffer });
      const attachHelperList = [
        testInfo.attach.bind(testInfo),
        testInfo['attach'].bind(testInfo),
        attachEvidence,
        attachEvidenceByElement,
      ];
      await attachHelperList[0]('image', { body: imageBuffer });
      await attachHelperList[1]('image', { body: imageBuffer });
      await attachHelperList[2]('image', { body: imageBuffer });
      await attachHelperList[3]('image', { body: imageBuffer });
      const [listedAttachEvidence] = attachHelperList;
      await listedAttachEvidence('image', { body: imageBuffer });
      attachHelperList[4] = testInfo.attach.bind(testInfo);
      await attachHelperList[4]('image', { body: imageBuffer });
      await testInfo.attach.call(testInfo, 'image', { body: imageBuffer });
      await testInfo['attach'].apply(testInfo, ['image', { body: imageBuffer }]);
      await attachEvidence.call(testInfo, 'image', { body: imageBuffer });
      await Reflect.apply(testInfo.attach, testInfo, ['image', { body: imageBuffer }]);
      await Reflect.apply(attachEvidence, testInfo, ['reflect raw evidence', { contentType: 'image/png' }]);
      await testInfo.attach('markdown', { body: markdown });
      const forwardAttachEvidence = testInfo.attach.bind(testInfo);
      const forwardAttachmentName = 'image';
      const forwardContentType = 'image/avif';
      const forwardRawImagePayload = { body: imageBuffer, contentType: forwardContentType };
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
      'tests/docs/example/direct-image.doc.ts:13:13',
      'tests/docs/example/direct-image.doc.ts:17:13',
      'tests/docs/example/direct-image.doc.ts:23:13',
      'tests/docs/example/direct-image.doc.ts:24:13',
      'tests/docs/example/direct-image.doc.ts:25:13',
      'tests/docs/example/direct-image.doc.ts:27:13',
      'tests/docs/example/direct-image.doc.ts:29:13',
      'tests/docs/example/direct-image.doc.ts:30:13',
      'tests/docs/example/direct-image.doc.ts:32:13',
      'tests/docs/example/direct-image.doc.ts:34:13',
      'tests/docs/example/direct-image.doc.ts:36:13',
      'tests/docs/example/direct-image.doc.ts:38:13',
      'tests/docs/example/direct-image.doc.ts:40:13',
      'tests/docs/example/direct-image.doc.ts:41:13',
      'tests/docs/example/direct-image.doc.ts:42:13',
      'tests/docs/example/direct-image.doc.ts:43:13',
      'tests/docs/example/direct-image.doc.ts:45:13',
      'tests/docs/example/direct-image.doc.ts:47:13',
      'tests/docs/example/direct-image.doc.ts:49:13',
      'tests/docs/example/direct-image.doc.ts:51:13',
      'tests/docs/example/direct-image.doc.ts:53:13',
      'tests/docs/example/direct-image.doc.ts:63:13',
      'tests/docs/example/direct-image.doc.ts:67:13',
      'tests/docs/example/direct-image.doc.ts:70:13',
      'tests/docs/example/direct-image.doc.ts:74:13',
      'tests/docs/example/direct-image.doc.ts:77:13',
      'tests/docs/example/direct-image.doc.ts:81:13',
      'tests/docs/example/direct-image.doc.ts:84:13',
      'tests/docs/example/direct-image.doc.ts:85:13',
      'tests/docs/example/direct-image.doc.ts:86:13',
      'tests/docs/example/direct-image.doc.ts:87:13',
      'tests/docs/example/direct-image.doc.ts:88:13',
      'tests/docs/example/direct-image.doc.ts:89:13',
      'tests/docs/example/direct-image.doc.ts:96:13',
      'tests/docs/example/direct-image.doc.ts:97:13',
      'tests/docs/example/direct-image.doc.ts:98:13',
      'tests/docs/example/direct-image.doc.ts:99:13',
      'tests/docs/example/direct-image.doc.ts:101:13',
      'tests/docs/example/direct-image.doc.ts:103:13',
      'tests/docs/example/direct-image.doc.ts:104:13',
      'tests/docs/example/direct-image.doc.ts:106:13',
      'tests/docs/example/direct-image.doc.ts:107:13',
      'tests/docs/example/direct-image.doc.ts:108:13',
      'tests/docs/example/direct-image.doc.ts:109:13',
      'tests/docs/example/direct-image.doc.ts:110:13',
      'tests/docs/example/direct-image.doc.ts:112:13',
      'tests/docs/example/direct-image.doc.ts:118:13',
      'tests/docs/example/direct-image.doc.ts:119:13',
      'tests/docs/example/direct-image.doc.ts:120:13',
      'tests/docs/example/direct-image.doc.ts:122:13',
      'tests/docs/example/direct-image.doc.ts:124:13',
      'tests/docs/example/direct-image.doc.ts:125:13',
      'tests/docs/example/direct-image.doc.ts:127:13',
      'tests/docs/example/direct-image.doc.ts:134:13',
      'tests/docs/example/direct-image.doc.ts:135:13',
      'tests/docs/example/direct-image.doc.ts:136:13',
      'tests/docs/example/direct-image.doc.ts:137:13',
      'tests/docs/example/direct-image.doc.ts:139:13',
      'tests/docs/example/direct-image.doc.ts:143:13',
      'tests/docs/example/direct-image.doc.ts:150:13',
      'tests/docs/example/direct-image.doc.ts:151:13',
      'tests/docs/example/direct-image.doc.ts:152:13',
      'tests/docs/example/direct-image.doc.ts:153:13',
      'tests/docs/example/direct-image.doc.ts:155:13',
      'tests/docs/example/direct-image.doc.ts:157:13',
      'tests/docs/example/direct-image.doc.ts:158:13',
      'tests/docs/example/direct-image.doc.ts:159:13',
      'tests/docs/example/direct-image.doc.ts:160:13',
      'tests/docs/example/direct-image.doc.ts:161:13',
      'tests/docs/example/direct-image.doc.ts:162:13',
    ]);
  });

  it('detects spread direct image attachment arguments before generated docs can use them', () => {
    const spreadDirectImageAttachmentSource = `
      const imageArgs = ['image', { body: imageBuffer }] as const;
      const markdownArgs = ['markdown', { body: markdown }] as const;
      const attachEvidence = testInfo.attach.bind(testInfo);
      const attachHelpers = { evidence: attachEvidence };
      await testInfo.attach(...imageArgs);
      await attachEvidence(...imageArgs);
      await attachHelpers.evidence(...imageArgs);
      await testInfo.attach.call(testInfo, ...imageArgs);
      await testInfo.attach.apply(testInfo, imageArgs);
      await testInfo.attach.apply(testInfo, [...imageArgs]);
      await testInfo.attach.apply(testInfo, markdownArgs);
      await testInfo.attach(...markdownArgs);
    `;

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/spread-direct-image.doc.ts',
        spreadDirectImageAttachmentSource,
      ),
    ).toEqual([
      'tests/docs/example/spread-direct-image.doc.ts:6:13',
      'tests/docs/example/spread-direct-image.doc.ts:7:13',
      'tests/docs/example/spread-direct-image.doc.ts:8:13',
      'tests/docs/example/spread-direct-image.doc.ts:9:13',
      'tests/docs/example/spread-direct-image.doc.ts:10:13',
      'tests/docs/example/spread-direct-image.doc.ts:11:13',
      'tests/docs/example/spread-direct-image.doc.ts:12:13',
      'tests/docs/example/spread-direct-image.doc.ts:13:13',
    ]);
  });

  it('detects spread raw image payloads before generated docs can use them', () => {
    const spreadRawImagePayloadSource = `
      const rawImagePayload = { body: imageBuffer, contentType: 'image/png' };
      const rawImagePathPayload = { path: 'raw-evidence.webp' };
      await testInfo.attach('raw evidence', { ...rawImagePayload });
      await testInfo.attach('raw file evidence', { ...rawImagePathPayload });
      const rawMarkdownPayload = { body: '![raw](raw.png)' };
      await testInfo.attach('markdown', { ...rawMarkdownPayload });
    `;

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/spread-raw-image-payload.doc.ts',
        spreadRawImagePayloadSource,
      ),
    ).toEqual([
      'tests/docs/example/spread-raw-image-payload.doc.ts:4:13',
      'tests/docs/example/spread-raw-image-payload.doc.ts:5:13',
    ]);

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/spread-raw-image-payload.doc.ts',
        spreadRawImagePayloadSource,
      ),
    ).toEqual(['tests/docs/example/spread-raw-image-payload.doc.ts:7:13']);
  });

  it('detects Object.assign raw image payloads before generated docs can use them', () => {
    const objectAssignRawImagePayloadSource = `
      const rawImagePayload = { body: imageBuffer, contentType: 'image/png' };
      const rawImagePathPayload = { path: 'raw-evidence.webp' };
      await testInfo.attach('raw evidence', Object.assign({}, rawImagePayload));
      await testInfo.attach('raw file evidence', Object.assign({}, rawImagePathPayload));
      const rawMarkdownPayload = { body: '![raw](raw.png)' };
      await testInfo.attach('markdown', Object.assign({}, rawMarkdownPayload));
    `;

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/object-assign-raw-image-payload.doc.ts',
        objectAssignRawImagePayloadSource,
      ),
    ).toEqual([
      'tests/docs/example/object-assign-raw-image-payload.doc.ts:4:13',
      'tests/docs/example/object-assign-raw-image-payload.doc.ts:5:13',
    ]);

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/object-assign-raw-image-payload.doc.ts',
        objectAssignRawImagePayloadSource,
      ),
    ).toEqual([
      'tests/docs/example/object-assign-raw-image-payload.doc.ts:7:13',
    ]);
  });

  it('detects object-rest raw image payloads before generated docs can use them', () => {
    const objectRestRawImagePayloadSource = `
      const rawImagePayload = { body: imageBuffer, contentType: 'image/png' };
      const rawImagePathPayload = { path: 'raw-evidence.webp' };
      const { ...copiedRawImagePayload } = rawImagePayload;
      await testInfo.attach('raw evidence', copiedRawImagePayload);
      const { ...copiedRawImagePathPayload } = rawImagePathPayload;
      await testInfo.attach('raw file evidence', copiedRawImagePathPayload);
      const rawMarkdownPayload = { body: '![raw](raw.png)' };
      const { ...copiedRawMarkdownPayload } = rawMarkdownPayload;
      await testInfo.attach('markdown', copiedRawMarkdownPayload);
    `;

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/object-rest-raw-image-payload.doc.ts',
        objectRestRawImagePayloadSource,
      ),
    ).toEqual([
      'tests/docs/example/object-rest-raw-image-payload.doc.ts:5:13',
      'tests/docs/example/object-rest-raw-image-payload.doc.ts:7:13',
    ]);

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/object-rest-raw-image-payload.doc.ts',
        objectRestRawImagePayloadSource,
      ),
    ).toEqual([
      'tests/docs/example/object-rest-raw-image-payload.doc.ts:10:13',
    ]);
  });

  it('detects object-rest grouped raw image aliases before generated docs can use them', () => {
    const objectRestGroupedRawImageAliasSource = `
      const rawImagePayload = { body: imageBuffer, contentType: 'image/png' };
      const imagePayloadGroup = { rawImagePayload };
      const { ...copiedImagePayloadGroup } = imagePayloadGroup;
      await testInfo.attach('raw evidence', copiedImagePayloadGroup.rawImagePayload);
      const imageName = 'image';
      const imageNameGroup = { imageName };
      const { ...copiedImageNameGroup } = imageNameGroup;
      await testInfo.attach(copiedImageNameGroup.imageName, { body: imageBuffer });
      const attachEvidence = testInfo.attach.bind(testInfo);
      const attachGroup = { attachEvidence };
      const { ...copiedAttachGroup } = attachGroup;
      await copiedAttachGroup.attachEvidence('raw evidence', { contentType: 'image/png' });
      const rawMarkdownPayload = { body: '![raw](raw.png)' };
      const markdownPayloadGroup = { rawMarkdownPayload };
      const { ...copiedMarkdownPayloadGroup } = markdownPayloadGroup;
      await testInfo.attach('markdown', copiedMarkdownPayloadGroup.rawMarkdownPayload);
      const markdownName = 'markdown';
      const markdownNameGroup = { markdownName };
      const { ...copiedMarkdownNameGroup } = markdownNameGroup;
      await testInfo.attach(copiedMarkdownNameGroup.markdownName, rawMarkdownPayload);
    `;

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/object-rest-grouped-raw-image-alias.doc.ts',
        objectRestGroupedRawImageAliasSource,
      ),
    ).toEqual([
      'tests/docs/example/object-rest-grouped-raw-image-alias.doc.ts:5:13',
      'tests/docs/example/object-rest-grouped-raw-image-alias.doc.ts:9:13',
      'tests/docs/example/object-rest-grouped-raw-image-alias.doc.ts:13:13',
    ]);

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/object-rest-grouped-raw-image-alias.doc.ts',
        objectRestGroupedRawImageAliasSource,
      ),
    ).toEqual([
      'tests/docs/example/object-rest-grouped-raw-image-alias.doc.ts:17:13',
      'tests/docs/example/object-rest-grouped-raw-image-alias.doc.ts:21:13',
    ]);
  });

  it('detects direct image attachments hidden behind binding default aliases', () => {
    const bindingDefaultImageAttachmentSource = `
      const { capture = testInfo.attach.bind(testInfo) } = {};
      await capture('image', { body: imageBuffer });
      const [attachEvidence = testInfo['attach'].bind(testInfo)] = [];
      await attachEvidence('raw evidence', { contentType: 'image/png' });
      const { attachmentName = 'image' } = {};
      await testInfo.attach(attachmentName, { body: imageBuffer });
      const [imageMime = 'image/png'] = [];
      await testInfo.attach('raw evidence', { contentType: imageMime });
      const { rawImagePayload = { body: imageBuffer, contentType: 'image/webp' } } = {};
      await testInfo.attach('raw payload evidence', rawImagePayload);
    `;

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/binding-default-image-attachment.doc.ts',
        bindingDefaultImageAttachmentSource,
      ),
    ).toEqual([
      'tests/docs/example/binding-default-image-attachment.doc.ts:3:13',
      'tests/docs/example/binding-default-image-attachment.doc.ts:5:13',
      'tests/docs/example/binding-default-image-attachment.doc.ts:7:13',
      'tests/docs/example/binding-default-image-attachment.doc.ts:9:13',
      'tests/docs/example/binding-default-image-attachment.doc.ts:11:13',
    ]);
  });

  it('detects at-indexed direct image attachment aliases', () => {
    const atIndexedImageAttachmentSource = `
      const imageAttachmentName = 'image';
      const imageAttachmentNameList = [imageAttachmentName];
      await testInfo.attach(imageAttachmentNameList.at(0), { body: imageBuffer });
      const imageContentType = 'image/png';
      const imageContentTypes = [imageContentType];
      await testInfo.attach('raw evidence', { contentType: imageContentTypes.at(0) });
      const rawImagePayload = { contentType: 'image/png' };
      const rawImagePayloadList = [rawImagePayload];
      await testInfo.attach('raw evidence', rawImagePayloadList.at(0));
      const attachEvidence = testInfo.attach.bind(testInfo);
      const attachHelperList = [attachEvidence];
      await attachHelperList.at(0)('image', { body: imageBuffer });
    `;

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/at-indexed-direct-image.doc.ts',
        atIndexedImageAttachmentSource,
      ),
    ).toEqual([
      'tests/docs/example/at-indexed-direct-image.doc.ts:4:13',
      'tests/docs/example/at-indexed-direct-image.doc.ts:7:13',
      'tests/docs/example/at-indexed-direct-image.doc.ts:10:13',
      'tests/docs/example/at-indexed-direct-image.doc.ts:13:13',
    ]);
  });

  it('detects inline bound image attachments before generated docs can use them', () => {
    const inlineBoundImageAttachmentSource = `
      const markdownArgs = ['markdown', { body: markdown }] as const;
      const attachEvidence = testInfo.attach.bind(testInfo);
      const attachHelpers = { evidence: attachEvidence };
      await testInfo.attach.bind(testInfo)('image', { body: imageBuffer });
      await testInfo['attach'].bind(testInfo)('image', { body: imageBuffer });
      await attachEvidence.bind(testInfo)('image', { body: imageBuffer });
      await attachHelpers.evidence.bind(testInfo)('image', { body: imageBuffer });
      await testInfo.attach.bind(testInfo)(...markdownArgs);
      await testInfo.attach.bind(testInfo)('markdown', { body: markdown });
    `;

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/inline-bound-image-attachment.doc.ts',
        inlineBoundImageAttachmentSource,
      ),
    ).toEqual([
      'tests/docs/example/inline-bound-image-attachment.doc.ts:5:13',
      'tests/docs/example/inline-bound-image-attachment.doc.ts:6:13',
      'tests/docs/example/inline-bound-image-attachment.doc.ts:7:13',
      'tests/docs/example/inline-bound-image-attachment.doc.ts:8:13',
      'tests/docs/example/inline-bound-image-attachment.doc.ts:9:13',
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
      const [{ screenshot: nestedCapturePageScreenshot }] = [page];
      await nestedCapturePageScreenshot({ path: 'nested-page-alias.png' });
      await forwardCaptureScreenshot({ path: 'forward-page-alias.png' });
      const screenshotHelpers = {
        capture: page.screenshot.bind(page),
        ['computedCapture']: page.screenshot.bind(page),
        captureElement,
        captureFromAlias: capturePageByElement,
      };
      await screenshotHelpers.capture({ path: 'grouped-page-alias.png' });
      await screenshotHelpers['computedCapture']({ path: 'computed-grouped-page-alias.png' });
      await screenshotHelpers.captureElement({ path: 'grouped-shorthand-element-alias.png' });
      await screenshotHelpers.captureFromAlias({ path: 'grouped-property-page-alias.png' });
      const { capture: destructuredGroupedCapture } = screenshotHelpers;
      await destructuredGroupedCapture({ path: 'destructured-grouped-page-alias.png' });
      const [{ capture: nestedDestructuredGroupedCapture }] = [screenshotHelpers];
      await nestedDestructuredGroupedCapture({ path: 'nested-destructured-grouped-page-alias.png' });
      screenshotHelpers.assignedCapture = page.screenshot.bind(page);
      await screenshotHelpers.assignedCapture({ path: 'assigned-grouped-page-alias.png' });
      const screenshotHelperList = [
        page.screenshot.bind(page),
        page['screenshot'].bind(page),
        captureElement,
        capturePageByElement,
      ];
      await screenshotHelperList[0]({ path: 'listed-page-alias.png' });
      await screenshotHelperList[1]({ path: 'listed-bracket-page-alias.png' });
      await screenshotHelperList[2]({ path: 'listed-shorthand-element-alias.png' });
      await screenshotHelperList[3]({ path: 'listed-property-page-alias.png' });
      const [listedCaptureScreenshot] = screenshotHelperList;
      await listedCaptureScreenshot({ path: 'destructured-listed-page-alias.png' });
      screenshotHelperList[4] = page.screenshot.bind(page);
      await screenshotHelperList[4]({ path: 'assigned-listed-page-alias.png' });
      await page.screenshot.call(page, { path: 'page-call.png' });
      await page['screenshot'].apply(page, [{ path: 'page-apply.png' }]);
      await capturePageScreenshot.call(page, { path: 'page-alias-call.png' });
      await Reflect.apply(page.screenshot, page, [{ path: 'page-reflect.png' }]);
      await Reflect.apply(capturePageScreenshot, page, [{ path: 'page-alias-reflect.png' }]);
      await takeScreenshot(
        testInfo,
        settingsSurface,
        page,
        'Shared helper screenshot remains the allowed path',
      );
      const forwardCaptureScreenshot = page.screenshot.bind(page);
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
      'tests/docs/example/direct-screenshot.doc.ts:12:13',
      'tests/docs/example/direct-screenshot.doc.ts:13:13',
      'tests/docs/example/direct-screenshot.doc.ts:20:13',
      'tests/docs/example/direct-screenshot.doc.ts:21:13',
      'tests/docs/example/direct-screenshot.doc.ts:22:13',
      'tests/docs/example/direct-screenshot.doc.ts:23:13',
      'tests/docs/example/direct-screenshot.doc.ts:25:13',
      'tests/docs/example/direct-screenshot.doc.ts:29:13',
      'tests/docs/example/direct-screenshot.doc.ts:36:13',
      'tests/docs/example/direct-screenshot.doc.ts:37:13',
      'tests/docs/example/direct-screenshot.doc.ts:38:13',
      'tests/docs/example/direct-screenshot.doc.ts:39:13',
      'tests/docs/example/direct-screenshot.doc.ts:41:13',
      'tests/docs/example/direct-screenshot.doc.ts:43:13',
      'tests/docs/example/direct-screenshot.doc.ts:44:13',
      'tests/docs/example/direct-screenshot.doc.ts:45:13',
      'tests/docs/example/direct-screenshot.doc.ts:46:13',
      'tests/docs/example/direct-screenshot.doc.ts:47:13',
      'tests/docs/example/direct-screenshot.doc.ts:48:13',
    ]);
  });

  it('detects direct screenshots hidden behind binding default aliases', () => {
    const bindingDefaultScreenshotSource = `
      const { capture = page.screenshot.bind(page) } = {};
      await capture({ path: 'default-object-page.png' });
      const [captureElement = page.locator('main').screenshot.bind(page.locator('main'))] = [];
      await captureElement({ path: 'default-array-element.png' });
    `;

    expect(
      findDirectScreenshotCalls(
        'tests/docs/example/binding-default-screenshot.doc.ts',
        bindingDefaultScreenshotSource,
      ),
    ).toEqual([
      'tests/docs/example/binding-default-screenshot.doc.ts:3:13',
      'tests/docs/example/binding-default-screenshot.doc.ts:5:13',
    ]);
  });

  it('detects at-indexed raw screenshot aliases', () => {
    const atIndexedScreenshotSource = `
      const capturePageScreenshot = page.screenshot.bind(page);
      const screenshotHelperList = [page.screenshot.bind(page), capturePageScreenshot];
      await screenshotHelperList.at(0)({ path: 'at-page.png' });
      await screenshotHelperList.at(1)({ path: 'at-alias.png' });
      await Reflect.apply(screenshotHelperList.at(0), page, [{ path: 'at-reflect.png' }]);
    `;

    expect(
      findDirectScreenshotCalls(
        'tests/docs/example/at-indexed-screenshot.doc.ts',
        atIndexedScreenshotSource,
      ),
    ).toEqual([
      'tests/docs/example/at-indexed-screenshot.doc.ts:4:13',
      'tests/docs/example/at-indexed-screenshot.doc.ts:5:13',
      'tests/docs/example/at-indexed-screenshot.doc.ts:6:13',
    ]);
  });

  it('detects raw docs image capture hidden behind comma expressions', () => {
    const commaExpressionSource = `
      async function captureDocsEvidence() {
        const attachEvidence = testInfo.attach.bind(testInfo);
        const capturePageScreenshot = page.screenshot.bind(page);
        await (undefined, page.screenshot)({ path: 'page.png' });
        await (undefined, page['screenshot'])({ path: 'page-bracket.png' });
        await (undefined, capturePageScreenshot)({ path: 'page-alias.png' });
        await (undefined, testInfo.attach)('image', { body: imageBuffer });
        await (undefined, testInfo['attach'])('image', { body: imageBuffer });
        await (undefined, attachEvidence)('raw evidence', { contentType: 'image/png' });
        await takeScreenshot(
          testInfo,
          settingsSurface,
          page,
          'Shared helper screenshot remains the allowed path',
        );
        await testInfo.attach('markdown', { body: markdown });
      }
    `;

    expect(
      findDirectScreenshotCalls(
        'tests/docs/example/comma-expression-image-capture.doc.ts',
        commaExpressionSource,
      ),
    ).toEqual([
      'tests/docs/example/comma-expression-image-capture.doc.ts:5:15',
      'tests/docs/example/comma-expression-image-capture.doc.ts:6:15',
      'tests/docs/example/comma-expression-image-capture.doc.ts:7:15',
    ]);

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/comma-expression-image-capture.doc.ts',
        commaExpressionSource,
      ),
    ).toEqual([
      'tests/docs/example/comma-expression-image-capture.doc.ts:8:15',
      'tests/docs/example/comma-expression-image-capture.doc.ts:9:15',
      'tests/docs/example/comma-expression-image-capture.doc.ts:10:15',
    ]);
  });

  it('detects raw docs image capture hidden behind branching callees', () => {
    const branchingCalleeSource = `
      async function captureDocsEvidence(useRaw: boolean) {
        const attachEvidence = testInfo.attach.bind(testInfo);
        const capturePageScreenshot = page.screenshot.bind(page);
        const markdownPayload = { body: '![raw](raw.png)' };
        await (useRaw ? page.screenshot : captureSafe)({ path: 'page.png' });
        await (safeCapture || page['screenshot'])({ path: 'page-logical.png' });
        await (maybeCapture ?? capturePageScreenshot)({ path: 'page-nullish.png' });
        await (useRaw ? testInfo.attach : attachSafe)('image', { body: imageBuffer });
        await (attachSafe || testInfo['attach'])('image', { body: imageBuffer });
        await (maybeAttach ?? attachEvidence)('raw evidence', { contentType: 'image/png' });
        await (useRaw ? testInfo.attach : attachSafe)('markdown', markdownPayload);
        await takeScreenshot(
          testInfo,
          settingsSurface,
          page,
          'Shared helper screenshot remains the allowed path',
        );
        await testInfo.attach('markdown', { body: markdown });
      }
    `;

    expect(
      findDirectScreenshotCalls(
        'tests/docs/example/branching-callee-image-capture.doc.ts',
        branchingCalleeSource,
      ),
    ).toEqual([
      'tests/docs/example/branching-callee-image-capture.doc.ts:6:15',
      'tests/docs/example/branching-callee-image-capture.doc.ts:7:15',
      'tests/docs/example/branching-callee-image-capture.doc.ts:8:15',
    ]);

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/branching-callee-image-capture.doc.ts',
        branchingCalleeSource,
      ),
    ).toEqual([
      'tests/docs/example/branching-callee-image-capture.doc.ts:9:15',
      'tests/docs/example/branching-callee-image-capture.doc.ts:10:15',
      'tests/docs/example/branching-callee-image-capture.doc.ts:11:15',
    ]);

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/branching-callee-image-capture.doc.ts',
        branchingCalleeSource,
      ),
    ).toEqual([
      'tests/docs/example/branching-callee-image-capture.doc.ts:12:15',
    ]);
  });

  it('detects raw docs image capture hidden behind nested branching callees', () => {
    const nestedBranchingCalleeSource = `
      async function captureDocsEvidence(useRaw: boolean, preferDirect: boolean) {
        const attachEvidence = testInfo.attach.bind(testInfo);
        const capturePageScreenshot = page.screenshot.bind(page);
        const markdownPayload = { body: '![raw](raw.png)' };
        await (useRaw ? (preferDirect ? page.screenshot : captureSafe) : captureSafe)({ path: 'page.png' });
        await (safeCapture || (maybeCapture ?? capturePageScreenshot))({ path: 'page-nullish.png' });
        await (useRaw ? (preferDirect ? testInfo.attach : attachSafe) : attachSafe)('image', { body: imageBuffer });
        await (attachSafe || (maybeAttach ?? attachEvidence))('raw evidence', { contentType: 'image/png' });
        await (useRaw ? (preferDirect ? testInfo.attach : attachSafe) : attachSafe)('markdown', markdownPayload);
      }
    `;

    expect(
      findDirectScreenshotCalls(
        'tests/docs/example/nested-branching-callee-image-capture.doc.ts',
        nestedBranchingCalleeSource,
      ),
    ).toEqual([
      'tests/docs/example/nested-branching-callee-image-capture.doc.ts:6:15',
      'tests/docs/example/nested-branching-callee-image-capture.doc.ts:7:15',
    ]);

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/nested-branching-callee-image-capture.doc.ts',
        nestedBranchingCalleeSource,
      ),
    ).toEqual([
      'tests/docs/example/nested-branching-callee-image-capture.doc.ts:8:15',
      'tests/docs/example/nested-branching-callee-image-capture.doc.ts:9:15',
    ]);

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/nested-branching-callee-image-capture.doc.ts',
        nestedBranchingCalleeSource,
      ),
    ).toEqual([
      'tests/docs/example/nested-branching-callee-image-capture.doc.ts:10:15',
    ]);
  });

  it('detects computed static property raw capture spellings', () => {
    const computedStaticPropertySource = `
      async function captureDocsEvidence() {
        const rawImagePayload = { ['content' + 'Type']: 'image/png' };
        const rawMarkdownPayload = { ['bo' + 'dy']: '![raw](raw.png)' };
        await page['screen' + 'shot']({ path: 'page.png' });
        const capturePageScreenshot = page['screen' + 'shot'].bind(page);
        await capturePageScreenshot({ path: 'page-alias.png' });
        await testInfo['att' + 'ach']('image', { body: imageBuffer });
        await testInfo.attach('raw evidence', rawImagePayload);
        await testInfo['att' + 'ach']('markdown', rawMarkdownPayload);
        await documentationReporter['take' + 'Screenshot'](
          testInfo,
          settingsSurface,
          page,
          'Computed property helper bypass with descriptive caption',
        );
        await import('../../support/reporters/' + 'documentation-reporter');
      }
    `;

    expect(
      findDirectScreenshotCalls(
        'tests/docs/example/computed-static-property-capture.doc.ts',
        computedStaticPropertySource,
      ),
    ).toEqual([
      'tests/docs/example/computed-static-property-capture.doc.ts:5:15',
      'tests/docs/example/computed-static-property-capture.doc.ts:7:15',
    ]);

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/computed-static-property-capture.doc.ts',
        computedStaticPropertySource,
      ),
    ).toEqual([
      'tests/docs/example/computed-static-property-capture.doc.ts:8:15',
      'tests/docs/example/computed-static-property-capture.doc.ts:9:15',
    ]);

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/computed-static-property-capture.doc.ts',
        computedStaticPropertySource,
      ),
    ).toEqual([
      'tests/docs/example/computed-static-property-capture.doc.ts:10:15',
    ]);

    expect(
      findScreenshotHelperBypasses(
        'tests/docs/example/computed-static-property-capture.doc.ts',
        computedStaticPropertySource,
      ),
    ).toEqual([
      'tests/docs/example/computed-static-property-capture.doc.ts:6:15',
      'tests/docs/example/computed-static-property-capture.doc.ts:11:15',
      'tests/docs/example/computed-static-property-capture.doc.ts:17:15',
    ]);
  });

  it('detects constant-backed property raw capture spellings', () => {
    const constantBackedPropertySource = `
      async function captureDocsEvidence() {
        const screenshotKey = 'screen' + 'shot';
        const attachKey = \`attach\`;
        const helperKey = 'takeScreenshot';
        const contentTypeKey = 'contentType';
        const markdownBodyKey = 'body';
        const markdownName = 'mark' + 'down';
        const reporterPath = '../../support/reporters/documentation-reporter';
        const rawImagePayload = { [contentTypeKey]: 'image/png' };
        const rawMarkdownPayload = { [markdownBodyKey]: '![raw](raw.png)' };
        await page[screenshotKey]({ path: 'page.png' });
        const capturePageScreenshot = page[screenshotKey].bind(page);
        await capturePageScreenshot({ path: 'page-alias.png' });
        const screenshotHelpers = { [screenshotKey]: page[screenshotKey] };
        const { [screenshotKey]: groupedCapture } = screenshotHelpers;
        await groupedCapture({ path: 'page-destructured-alias.png' });
        await testInfo[attachKey]('image', { body: imageBuffer });
        await testInfo.attach('raw evidence', rawImagePayload);
        await testInfo[attachKey](markdownName, rawMarkdownPayload);
        const attachHelpers = { [attachKey]: testInfo[attachKey] };
        await attachHelpers[attachKey]('raw evidence', { contentType: 'image/webp' });
        await documentationReporter[helperKey](
          testInfo,
          settingsSurface,
          page,
          'Constant property helper bypass with descriptive caption',
        );
        await import(reporterPath);
      }
    `;

    expect(
      findDirectScreenshotCalls(
        'tests/docs/example/constant-backed-property-capture.doc.ts',
        constantBackedPropertySource,
      ),
    ).toEqual([
      'tests/docs/example/constant-backed-property-capture.doc.ts:12:15',
      'tests/docs/example/constant-backed-property-capture.doc.ts:14:15',
      'tests/docs/example/constant-backed-property-capture.doc.ts:17:15',
    ]);

    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/constant-backed-property-capture.doc.ts',
        constantBackedPropertySource,
      ),
    ).toEqual([
      'tests/docs/example/constant-backed-property-capture.doc.ts:18:15',
      'tests/docs/example/constant-backed-property-capture.doc.ts:19:15',
      'tests/docs/example/constant-backed-property-capture.doc.ts:22:15',
    ]);

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/constant-backed-property-capture.doc.ts',
        constantBackedPropertySource,
      ),
    ).toEqual([
      'tests/docs/example/constant-backed-property-capture.doc.ts:20:15',
    ]);

    expect(
      findScreenshotHelperBypasses(
        'tests/docs/example/constant-backed-property-capture.doc.ts',
        constantBackedPropertySource,
      ),
    ).toEqual([
      'tests/docs/example/constant-backed-property-capture.doc.ts:3:15',
      'tests/docs/example/constant-backed-property-capture.doc.ts:13:15',
      'tests/docs/example/constant-backed-property-capture.doc.ts:15:15',
      'tests/docs/example/constant-backed-property-capture.doc.ts:23:15',
      'tests/docs/example/constant-backed-property-capture.doc.ts:29:15',
    ]);
  });

  it('detects inline bound raw screenshot calls before generated docs can use them', () => {
    const inlineBoundScreenshotSource = `
      const capturePageScreenshot = page.screenshot.bind(page);
      const screenshotHelpers = { capture: capturePageScreenshot };
      await page.screenshot.bind(page)({ path: 'page-bind.png' });
      await page['screenshot'].bind(page)({ path: 'page-bracket-bind.png' });
      await capturePageScreenshot.bind(page)({ path: 'page-alias-bind.png' });
      await screenshotHelpers.capture.bind(page)({ path: 'page-helper-bind.png' });
      await takeScreenshot(
        testInfo,
        settingsSurface,
        page,
        'Shared helper screenshot remains the allowed path',
      );
    `;

    expect(
      findDirectScreenshotCalls(
        'tests/docs/example/inline-bound-screenshot.doc.ts',
        inlineBoundScreenshotSource,
      ),
    ).toEqual([
      'tests/docs/example/inline-bound-screenshot.doc.ts:4:13',
      'tests/docs/example/inline-bound-screenshot.doc.ts:5:13',
      'tests/docs/example/inline-bound-screenshot.doc.ts:6:13',
      'tests/docs/example/inline-bound-screenshot.doc.ts:7:13',
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

  it('inspects optional documentation screenshot and raw image calls', () => {
    const optionalCallSource = `
      async function captureEvidence() {
        await takeScreenshot?.(
          testInfo,
          page.locator('main'),
          page,
          'Optional helper generic shell target with a descriptive caption',
        );
        await takeScreenshot?.(
          testInfo,
          settingsSurface,
          page,
          'Too short',
        );
        await page.screenshot?.({ path: 'page.png' });
        await page['screenshot']?.({ path: 'page-bracket.png' });
        await testInfo.attach?.('image', { body: imageBuffer });
        await testInfo['attach']?.('raw evidence', { contentType: 'image/png' });
        await testInfo.attach?.('markdown', { body: '![raw](raw.png)' });
      }
    `;

    expect(
      countTakeScreenshotCalls(
        'tests/docs/example/optional-call-image-capture.doc.ts',
        optionalCallSource,
      ),
    ).toBe(2);
    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/optional-call-image-capture.doc.ts',
        optionalCallSource,
      ),
    ).toEqual(['tests/docs/example/optional-call-image-capture.doc.ts:3:15']);
    expect(
      findWeakScreenshotCaptions(
        'tests/docs/example/optional-call-image-capture.doc.ts',
        optionalCallSource,
      ),
    ).toEqual(['tests/docs/example/optional-call-image-capture.doc.ts:9:15']);
    expect(
      findDirectScreenshotCalls(
        'tests/docs/example/optional-call-image-capture.doc.ts',
        optionalCallSource,
      ),
    ).toEqual([
      'tests/docs/example/optional-call-image-capture.doc.ts:15:15',
      'tests/docs/example/optional-call-image-capture.doc.ts:16:15',
    ]);
    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/optional-call-image-capture.doc.ts',
        optionalCallSource,
      ),
    ).toEqual([
      'tests/docs/example/optional-call-image-capture.doc.ts:17:15',
      'tests/docs/example/optional-call-image-capture.doc.ts:18:15',
    ]);
    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/optional-call-image-capture.doc.ts',
        optionalCallSource,
      ),
    ).toEqual(['tests/docs/example/optional-call-image-capture.doc.ts:19:15']);
  });

  it('detects raw markdown image markup before generated docs can use it', () => {
    const rawMarkdownImageSource = `
      const markdownAttachmentName = 'markdown';
      const rawMarkdownBody = \`
        Introductory aliased copy.
        ![Aliased screenshot](../aliased.png)
      \`;
      const body = \`
        More aliased copy.
        <img src="../unrelated.png" alt="Unrelated screenshot">
      \`;
      const rawMarkdownPayload = {
        body: rawMarkdownBody,
      };
      const shorthandMarkdownPayload = { body };
      const bufferedMarkdownPayload = { body: Buffer.from(rawMarkdownBody) };
      const stringWrappedMarkdownPayload = { body: String(body) };
      const interpolatedMarkdownPayload = { body: \`\${rawMarkdownBody}\` };
      const conditionalMarkdownPayload = {
        body: useRawMarkdown ? rawMarkdownBody : 'Plain fallback',
      };
      const nullishMarkdownPayload = { body: safeMarkdownBody ?? rawMarkdownBody };
      const logicalMarkdownPayload = { body: safeMarkdownBody || rawMarkdownBody };
      await testInfo.attach('markdown', {
        body: \`
          Introductory copy.
          ![Unrelated screenshot](../unrelated.png)
        \`,
      });
      await testInfo['attach'](markdownAttachmentName, {
        body: rawMarkdownBody,
      });
      await testInfo.attach(markdownAttachmentName, { body });
      await testInfo.attach('markdown', {
        body: Buffer.from(rawMarkdownBody),
      });
      await testInfo.attach(markdownAttachmentName, {
        body: String(body),
      });
      await testInfo.attach('markdown', {
        body: \`\${rawMarkdownBody}\`,
      });
      await testInfo.attach('markdown', {
        body: useRawMarkdown ? rawMarkdownBody : 'Plain fallback',
      });
      await testInfo.attach(markdownAttachmentName, {
        body: safeMarkdownBody ?? rawMarkdownBody,
      });
      await testInfo.attach('markdown', {
        body: safeMarkdownBody || rawMarkdownBody,
      });
      await testInfo.attach('markdown', rawMarkdownPayload);
      await testInfo.attach(markdownAttachmentName, shorthandMarkdownPayload);
      await testInfo.attach('markdown', bufferedMarkdownPayload);
      await testInfo.attach(markdownAttachmentName, stringWrappedMarkdownPayload);
      await testInfo.attach('markdown', interpolatedMarkdownPayload);
      await testInfo.attach('markdown', conditionalMarkdownPayload);
      await testInfo.attach(markdownAttachmentName, nullishMarkdownPayload);
      await testInfo.attach('markdown', logicalMarkdownPayload);
      const rawMarkdownPayloads = {
        evidence: rawMarkdownPayload,
        shorthandMarkdownPayload,
      };
      const rawMarkdownPayloadList = [
        rawMarkdownPayload,
        shorthandMarkdownPayload,
      ];
      await testInfo.attach('markdown', rawMarkdownPayloads.evidence);
      await testInfo.attach(
        markdownAttachmentName,
        rawMarkdownPayloads.shorthandMarkdownPayload,
      );
      await testInfo.attach('markdown', rawMarkdownPayloadList[0]);
      const { evidence: groupedRawMarkdownPayload } = rawMarkdownPayloads;
      await testInfo.attach('markdown', groupedRawMarkdownPayload);
      rawMarkdownPayloads.assignedEvidence = rawMarkdownPayload;
      await testInfo.attach('markdown', rawMarkdownPayloads.assignedEvidence);
      const attachMarkdownEvidence = testInfo.attach.bind(testInfo);
      const { attach: destructuredAttachMarkdownEvidence } = testInfo;
      const attachHelpers = { evidence: attachMarkdownEvidence };
      const attachHelperList = [attachMarkdownEvidence];
      await attachMarkdownEvidence('markdown', rawMarkdownPayload);
      await destructuredAttachMarkdownEvidence(
        markdownAttachmentName,
        shorthandMarkdownPayload,
      );
      await attachHelpers.evidence('markdown', rawMarkdownPayload);
      await attachHelperList[0](markdownAttachmentName, shorthandMarkdownPayload);
      attachHelpers.assignedEvidence = testInfo.attach.bind(testInfo);
      await attachHelpers.assignedEvidence('markdown', rawMarkdownPayload);
      const rawMarkdownArgs = ['markdown', rawMarkdownPayload] as const;
      await testInfo.attach(...rawMarkdownArgs);
      await attachMarkdownEvidence(...rawMarkdownArgs);
      await testInfo.attach.call(testInfo, 'markdown', rawMarkdownPayload);
      await testInfo['attach'].apply(testInfo, [
        'markdown',
        rawMarkdownPayload,
      ]);
      await attachMarkdownEvidence.call(
        testInfo,
        markdownAttachmentName,
        shorthandMarkdownPayload,
      );
      await Reflect.apply(testInfo.attach, testInfo, [
        'markdown',
        rawMarkdownPayload,
      ]);
      await Reflect.apply(attachMarkdownEvidence, testInfo, [
        markdownAttachmentName,
        shorthandMarkdownPayload,
      ]);
      await testInfo.attach.bind(testInfo)('markdown', rawMarkdownPayload);
      await attachHelpers.evidence.bind(testInfo)(
        markdownAttachmentName,
        shorthandMarkdownPayload,
      );
      await testInfo.attach('markdown', {
        body: \`
          Links to [image guidance](../images) stay valid.
        \`,
      });
    `;

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/raw-markdown-image.doc.ts',
        rawMarkdownImageSource,
      ),
    ).toEqual([
      'tests/docs/example/raw-markdown-image.doc.ts:23:13',
      'tests/docs/example/raw-markdown-image.doc.ts:29:13',
      'tests/docs/example/raw-markdown-image.doc.ts:32:13',
      'tests/docs/example/raw-markdown-image.doc.ts:33:13',
      'tests/docs/example/raw-markdown-image.doc.ts:36:13',
      'tests/docs/example/raw-markdown-image.doc.ts:39:13',
      'tests/docs/example/raw-markdown-image.doc.ts:42:13',
      'tests/docs/example/raw-markdown-image.doc.ts:45:13',
      'tests/docs/example/raw-markdown-image.doc.ts:48:13',
      'tests/docs/example/raw-markdown-image.doc.ts:51:13',
      'tests/docs/example/raw-markdown-image.doc.ts:52:13',
      'tests/docs/example/raw-markdown-image.doc.ts:53:13',
      'tests/docs/example/raw-markdown-image.doc.ts:54:13',
      'tests/docs/example/raw-markdown-image.doc.ts:55:13',
      'tests/docs/example/raw-markdown-image.doc.ts:56:13',
      'tests/docs/example/raw-markdown-image.doc.ts:57:13',
      'tests/docs/example/raw-markdown-image.doc.ts:58:13',
      'tests/docs/example/raw-markdown-image.doc.ts:67:13',
      'tests/docs/example/raw-markdown-image.doc.ts:68:13',
      'tests/docs/example/raw-markdown-image.doc.ts:72:13',
      'tests/docs/example/raw-markdown-image.doc.ts:74:13',
      'tests/docs/example/raw-markdown-image.doc.ts:76:13',
      'tests/docs/example/raw-markdown-image.doc.ts:81:13',
      'tests/docs/example/raw-markdown-image.doc.ts:82:13',
      'tests/docs/example/raw-markdown-image.doc.ts:86:13',
      'tests/docs/example/raw-markdown-image.doc.ts:87:13',
      'tests/docs/example/raw-markdown-image.doc.ts:89:13',
      'tests/docs/example/raw-markdown-image.doc.ts:91:13',
      'tests/docs/example/raw-markdown-image.doc.ts:92:13',
      'tests/docs/example/raw-markdown-image.doc.ts:93:13',
      'tests/docs/example/raw-markdown-image.doc.ts:94:13',
      'tests/docs/example/raw-markdown-image.doc.ts:98:13',
      'tests/docs/example/raw-markdown-image.doc.ts:103:13',
      'tests/docs/example/raw-markdown-image.doc.ts:107:13',
      'tests/docs/example/raw-markdown-image.doc.ts:111:13',
      'tests/docs/example/raw-markdown-image.doc.ts:112:13',
    ]);
  });

  it('detects raw markdown images hidden behind binding default attach aliases', () => {
    const bindingDefaultMarkdownImageSource = `
      const rawMarkdownPayload = { body: '![raw](raw.png)' };
      const { capture = testInfo.attach.bind(testInfo) } = {};
      await capture('markdown', rawMarkdownPayload);
      const [attachEvidence = testInfo['attach'].bind(testInfo)] = [];
      await attachEvidence('markdown', rawMarkdownPayload);
      const { markdownAttachmentName = 'markdown' } = {};
      await capture(markdownAttachmentName, rawMarkdownPayload);
    `;

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/binding-default-markdown-image.doc.ts',
        bindingDefaultMarkdownImageSource,
      ),
    ).toEqual([
      'tests/docs/example/binding-default-markdown-image.doc.ts:4:13',
      'tests/docs/example/binding-default-markdown-image.doc.ts:6:13',
      'tests/docs/example/binding-default-markdown-image.doc.ts:8:13',
    ]);
  });

  it('detects raw markdown images hidden behind binding default body and payload aliases', () => {
    const bindingDefaultMarkdownBodySource = `
      const { rawMarkdownBody = '![raw](raw.png)' } = {};
      await testInfo.attach('markdown', { body: rawMarkdownBody });
      const [rawMarkdownPayload = { body: '<img src="../raw.png" alt="Raw">' }] = [];
      await testInfo.attach('markdown', rawMarkdownPayload);
    `;

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/binding-default-markdown-body.doc.ts',
        bindingDefaultMarkdownBodySource,
      ),
    ).toEqual([
      'tests/docs/example/binding-default-markdown-body.doc.ts:3:13',
      'tests/docs/example/binding-default-markdown-body.doc.ts:5:13',
    ]);
  });

  it('detects raw markdown images hidden behind grouped markdown names', () => {
    const groupedMarkdownNameSource = `
      const rawMarkdownPayload = { body: '![raw](raw.png)' };
      const markdownAttachmentName = 'markdown';
      const markdownNames = {
        evidence: markdownAttachmentName,
        markdownAttachmentName,
      };
      await testInfo.attach(markdownNames.evidence, rawMarkdownPayload);
      await testInfo.attach(markdownNames.markdownAttachmentName, rawMarkdownPayload);
      const markdownNameList = [markdownAttachmentName];
      await testInfo.attach(markdownNameList[0], rawMarkdownPayload);
      await testInfo.attach(markdownNameList.at(0), rawMarkdownPayload);
      const { evidence: groupedMarkdownName } = markdownNames;
      await testInfo.attach(groupedMarkdownName, rawMarkdownPayload);
      markdownNames.assigned = 'markdown';
      await testInfo.attach(markdownNames.assigned, rawMarkdownPayload);
    `;

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/grouped-markdown-name.doc.ts',
        groupedMarkdownNameSource,
      ),
    ).toEqual([
      'tests/docs/example/grouped-markdown-name.doc.ts:8:13',
      'tests/docs/example/grouped-markdown-name.doc.ts:9:13',
      'tests/docs/example/grouped-markdown-name.doc.ts:11:13',
      'tests/docs/example/grouped-markdown-name.doc.ts:12:13',
      'tests/docs/example/grouped-markdown-name.doc.ts:14:13',
      'tests/docs/example/grouped-markdown-name.doc.ts:16:13',
    ]);
  });

  it('detects raw markdown images hidden behind forwarded markdown names', () => {
    const forwardedMarkdownNameSource = `
      const rawMarkdownPayload = { body: '![raw](raw.png)' };
      const markdownAttachmentName = 'markdown';
      await testInfo.attach(String(markdownAttachmentName), rawMarkdownPayload);
      await testInfo.attach(\`\${markdownAttachmentName}\`, rawMarkdownPayload);
      await testInfo.attach(useMarkdown ? markdownAttachmentName : 'html', rawMarkdownPayload);
      await testInfo.attach(safeMarkdownName ?? markdownAttachmentName, rawMarkdownPayload);
      await testInfo.attach('mark' + 'down', rawMarkdownPayload);
    `;

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/forwarded-markdown-name.doc.ts',
        forwardedMarkdownNameSource,
      ),
    ).toEqual([
      'tests/docs/example/forwarded-markdown-name.doc.ts:4:13',
      'tests/docs/example/forwarded-markdown-name.doc.ts:5:13',
      'tests/docs/example/forwarded-markdown-name.doc.ts:6:13',
      'tests/docs/example/forwarded-markdown-name.doc.ts:7:13',
      'tests/docs/example/forwarded-markdown-name.doc.ts:8:13',
    ]);
  });

  it('detects raw markdown images hidden behind grouped body aliases', () => {
    const groupedMarkdownBodySource = `
      const rawMarkdownBody = '![raw](raw.png)';
      const rawMarkdownBodies = {
        evidence: rawMarkdownBody,
        rawMarkdownBody,
      };
      await testInfo.attach('markdown', { body: rawMarkdownBodies.evidence });
      await testInfo.attach('markdown', { body: rawMarkdownBodies.rawMarkdownBody });
      const rawMarkdownBodyList = [rawMarkdownBody];
      await testInfo.attach('markdown', { body: rawMarkdownBodyList[0] });
      await testInfo.attach('markdown', { body: rawMarkdownBodyList.at(0) });
      const { evidence: groupedRawMarkdownBody } = rawMarkdownBodies;
      await testInfo.attach('markdown', { body: groupedRawMarkdownBody });
      rawMarkdownBodies.assigned = '<img src="../raw.png" alt="Raw">';
      await testInfo.attach('markdown', { body: rawMarkdownBodies.assigned });
    `;

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/grouped-markdown-body.doc.ts',
        groupedMarkdownBodySource,
      ),
    ).toEqual([
      'tests/docs/example/grouped-markdown-body.doc.ts:7:13',
      'tests/docs/example/grouped-markdown-body.doc.ts:8:13',
      'tests/docs/example/grouped-markdown-body.doc.ts:10:13',
      'tests/docs/example/grouped-markdown-body.doc.ts:11:13',
      'tests/docs/example/grouped-markdown-body.doc.ts:13:13',
      'tests/docs/example/grouped-markdown-body.doc.ts:15:13',
    ]);
  });

  it('detects raw markdown images hidden behind at-indexed payload and attach aliases', () => {
    const atIndexedMarkdownSource = `
      const rawMarkdownPayload = { body: '![raw](raw.png)' };
      const rawMarkdownPayloadList = [rawMarkdownPayload];
      await testInfo.attach('markdown', rawMarkdownPayloadList.at(0));
      const attachEvidence = testInfo.attach.bind(testInfo);
      const attachHelperList = [attachEvidence];
      await attachHelperList.at(0)('markdown', rawMarkdownPayload);
    `;

    expect(
      findRawMarkdownImageMarkup(
        'tests/docs/example/at-indexed-markdown.doc.ts',
        atIndexedMarkdownSource,
      ),
    ).toEqual([
      'tests/docs/example/at-indexed-markdown.doc.ts:4:13',
      'tests/docs/example/at-indexed-markdown.doc.ts:7:13',
    ]);
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

  it('detects weak documentation screenshot targets hidden behind array spreads', () => {
    const spreadTargetSource = `
      const genericTargets = [page.locator('main')];
      const broadTargets = [page.locator('section')];
      const singleTargets = [page.getByRole('button', { name: 'Save' })];
      const iconTargets = [page.locator('svg')];

      await takeScreenshot(
        testInfo,
        [settingsSurface, ...genericTargets],
        page,
        'Spread generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, ...broadTargets],
        page,
        'Spread broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, ...singleTargets],
        page,
        'Spread single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, ...iconTargets],
        page,
        'Spread icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/spread-target.doc.ts',
        spreadTargetSource,
      ),
    ).toEqual(['tests/docs/example/spread-target.doc.ts:7:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/spread-target.doc.ts',
        spreadTargetSource,
      ),
    ).toEqual(['tests/docs/example/spread-target.doc.ts:13:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/spread-target.doc.ts',
        spreadTargetSource,
      ),
    ).toEqual(['tests/docs/example/spread-target.doc.ts:19:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/spread-target.doc.ts',
        spreadTargetSource,
      ),
    ).toEqual(['tests/docs/example/spread-target.doc.ts:25:13']);
  });

  it('detects weak documentation screenshot targets hidden behind array helper calls', () => {
    const arrayHelperTargetSource = `
      const returnsSingleControlTarget = () => page.getByRole('button', { name: 'Save' });

      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('main')].filter(Boolean),
        page,
        'Filtered generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].concat(page.locator('section')),
        page,
        'Concatenated broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        Array.of(settingsSurface, page.getByRole('button', { name: 'Save' })),
        page,
        'Array helper single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].concat(page.locator('svg')),
        page,
        'Concatenated icon target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        Array.from([settingsSurface, page.locator('main')]),
        page,
        'Array from generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        Array.from([settingsSurface], () => page.locator('section')),
        page,
        'Array from mapper broad target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        Array.from({ length: 1 }, returnsSingleControlTarget),
        page,
        'Array from named mapper control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        Array.from([settingsSurface], () => [page.locator('svg')]),
        page,
        'Array from mapper icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/array-helper-target.doc.ts',
        arrayHelperTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/array-helper-target.doc.ts:4:13',
      'tests/docs/example/array-helper-target.doc.ts:28:13',
    ]);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/array-helper-target.doc.ts',
        arrayHelperTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/array-helper-target.doc.ts:10:13',
      'tests/docs/example/array-helper-target.doc.ts:34:13',
    ]);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/array-helper-target.doc.ts',
        arrayHelperTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/array-helper-target.doc.ts:16:13',
      'tests/docs/example/array-helper-target.doc.ts:40:13',
    ]);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/array-helper-target.doc.ts',
        arrayHelperTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/array-helper-target.doc.ts:22:13',
      'tests/docs/example/array-helper-target.doc.ts:46:13',
    ]);
  });

  it('detects weak documentation screenshot targets preserved by concat receiver arrays', () => {
    const concatReceiverTargetSource = `
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('main')].concat([settingsSurface]),
        page,
        'Concat receiver generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('section')].concat([settingsSurface]),
        page,
        'Concat receiver broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.getByRole('button', { name: 'Save' })].concat(settingsSurface),
        page,
        'Concat receiver single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('svg')].concat(),
        page,
        'Concat receiver icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/concat-receiver-target.doc.ts',
        concatReceiverTargetSource,
      ),
    ).toEqual(['tests/docs/example/concat-receiver-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/concat-receiver-target.doc.ts',
        concatReceiverTargetSource,
      ),
    ).toEqual(['tests/docs/example/concat-receiver-target.doc.ts:8:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/concat-receiver-target.doc.ts',
        concatReceiverTargetSource,
      ),
    ).toEqual(['tests/docs/example/concat-receiver-target.doc.ts:14:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/concat-receiver-target.doc.ts',
        concatReceiverTargetSource,
      ),
    ).toEqual(['tests/docs/example/concat-receiver-target.doc.ts:20:13']);
  });

  it('detects weak documentation screenshot targets merged through concat argument arrays', () => {
    const concatArgumentTargetSource = `
      await takeScreenshot(
        testInfo,
        [settingsSurface].concat([page.locator('main')]),
        page,
        'Concat argument generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].concat([page.locator('section')]),
        page,
        'Concat argument broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].concat([page.getByRole('button', { name: 'Save' })]),
        page,
        'Concat argument single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].concat([page.locator('svg')]),
        page,
        'Concat argument icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/concat-argument-target.doc.ts',
        concatArgumentTargetSource,
      ),
    ).toEqual(['tests/docs/example/concat-argument-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/concat-argument-target.doc.ts',
        concatArgumentTargetSource,
      ),
    ).toEqual(['tests/docs/example/concat-argument-target.doc.ts:8:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/concat-argument-target.doc.ts',
        concatArgumentTargetSource,
      ),
    ).toEqual(['tests/docs/example/concat-argument-target.doc.ts:14:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/concat-argument-target.doc.ts',
        concatArgumentTargetSource,
      ),
    ).toEqual(['tests/docs/example/concat-argument-target.doc.ts:20:13']);
  });

  it('detects weak documentation screenshot targets returned by mutating array helpers', () => {
    const mutatingArrayTargetSource = `
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('main')].copyWithin(0, 1),
        page,
        'CopyWithin generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('section')].splice(1),
        page,
        'Splice broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.getByRole('button', { name: 'Save' })].copyWithin(0, 1),
        page,
        'CopyWithin single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('svg')].splice(1),
        page,
        'Splice icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/mutating-array-target.doc.ts',
        mutatingArrayTargetSource,
      ),
    ).toEqual(['tests/docs/example/mutating-array-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/mutating-array-target.doc.ts',
        mutatingArrayTargetSource,
      ),
    ).toEqual(['tests/docs/example/mutating-array-target.doc.ts:8:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/mutating-array-target.doc.ts',
        mutatingArrayTargetSource,
      ),
    ).toEqual(['tests/docs/example/mutating-array-target.doc.ts:14:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/mutating-array-target.doc.ts',
        mutatingArrayTargetSource,
      ),
    ).toEqual(['tests/docs/example/mutating-array-target.doc.ts:20:13']);
  });

  it('detects weak documentation screenshot targets inserted through toSpliced calls', () => {
    const arrayToSplicedTargetSource = `
      await takeScreenshot(
        testInfo,
        [settingsSurface].toSpliced(1, 0, page.locator('main')),
        page,
        'Spliced generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].toSpliced(1, 0, page.locator('section')),
        page,
        'Spliced broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].toSpliced(1, 0, page.getByRole('button', { name: 'Save' })),
        page,
        'Spliced single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].toSpliced(1, 0, page.locator('svg')),
        page,
        'Spliced icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/array-to-spliced-target.doc.ts',
        arrayToSplicedTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-to-spliced-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/array-to-spliced-target.doc.ts',
        arrayToSplicedTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-to-spliced-target.doc.ts:8:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/array-to-spliced-target.doc.ts',
        arrayToSplicedTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-to-spliced-target.doc.ts:14:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/array-to-spliced-target.doc.ts',
        arrayToSplicedTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-to-spliced-target.doc.ts:20:13']);
  });

  it('detects weak documentation screenshot targets inserted through replacement array helpers', () => {
    const arrayReplacementTargetSource = `
      await takeScreenshot(
        testInfo,
        [settingsSurface].with(0, page.locator('main')),
        page,
        'Replacement generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].with(0, page.locator('section')),
        page,
        'Replacement broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].fill(page.getByRole('button', { name: 'Save' })),
        page,
        'Filled single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].fill(page.locator('svg')),
        page,
        'Filled icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/array-replacement-target.doc.ts',
        arrayReplacementTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-replacement-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/array-replacement-target.doc.ts',
        arrayReplacementTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-replacement-target.doc.ts:8:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/array-replacement-target.doc.ts',
        arrayReplacementTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-replacement-target.doc.ts:14:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/array-replacement-target.doc.ts',
        arrayReplacementTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-replacement-target.doc.ts:20:13']);
  });

  it('detects weak documentation screenshot targets preserved by array copy and reorder helpers', () => {
    const arrayCopyAndReorderTargetSource = `
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('main')].slice(),
        page,
        'Sliced generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('main')].sort(),
        page,
        'Sorted generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('section')].reverse(),
        page,
        'Reversed broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.getByRole('button', { name: 'Save' })].toReversed(),
        page,
        'Copy-reversed single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('svg')].toSorted(),
        page,
        'Copy-sorted icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/array-copy-reorder-target.doc.ts',
        arrayCopyAndReorderTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/array-copy-reorder-target.doc.ts:2:13',
      'tests/docs/example/array-copy-reorder-target.doc.ts:8:13',
    ]);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/array-copy-reorder-target.doc.ts',
        arrayCopyAndReorderTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-copy-reorder-target.doc.ts:14:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/array-copy-reorder-target.doc.ts',
        arrayCopyAndReorderTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-copy-reorder-target.doc.ts:20:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/array-copy-reorder-target.doc.ts',
        arrayCopyAndReorderTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-copy-reorder-target.doc.ts:26:13']);
  });

  it('detects weak documentation screenshot targets selected by array element helpers', () => {
    const arrayElementHelperTargetSource = `
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('main')].find(Boolean),
        page,
        'Found generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('section')].findLast(Boolean),
        page,
        'Found last broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.getByRole('button', { name: 'Save' })].pop(),
        page,
        'Popped single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('svg')].shift(),
        page,
        'Shifted icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/array-element-helper-target.doc.ts',
        arrayElementHelperTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-element-helper-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/array-element-helper-target.doc.ts',
        arrayElementHelperTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-element-helper-target.doc.ts:8:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/array-element-helper-target.doc.ts',
        arrayElementHelperTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-element-helper-target.doc.ts:14:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/array-element-helper-target.doc.ts',
        arrayElementHelperTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-element-helper-target.doc.ts:20:13']);
  });

  it('detects weak documentation screenshot targets hidden behind array map calls', () => {
    const arrayMapTargetSource = `
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('main')].map((target) => target),
        page,
        'Mapped generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('section')].map((target) => target),
        page,
        'Mapped broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.getByRole('button', { name: 'Save' })].map((target) => target),
        page,
        'Mapped single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('svg')].map((target) => target),
        page,
        'Mapped icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/array-map-target.doc.ts',
        arrayMapTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-map-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/array-map-target.doc.ts',
        arrayMapTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-map-target.doc.ts:8:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/array-map-target.doc.ts',
        arrayMapTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-map-target.doc.ts:14:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/array-map-target.doc.ts',
        arrayMapTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-map-target.doc.ts:20:13']);
  });

  it('detects weak documentation screenshot targets hidden behind array reduce calls', () => {
    const arrayReduceTargetSource = `
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('main')].reduce((selected) => selected),
        page,
        'Reduced generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface, page.locator('section')].reduceRight((selected) => selected),
        page,
        'Reduced broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].reduce(() => page.getByRole('button', { name: 'Save' })),
        page,
        'Reducer callback single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].reduce((selected) => selected, page.locator('svg')),
        page,
        'Reducer initial icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/array-reduce-target.doc.ts',
        arrayReduceTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-reduce-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/array-reduce-target.doc.ts',
        arrayReduceTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-reduce-target.doc.ts:8:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/array-reduce-target.doc.ts',
        arrayReduceTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-reduce-target.doc.ts:14:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/array-reduce-target.doc.ts',
        arrayReduceTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-reduce-target.doc.ts:20:13']);
  });

  it('detects weak documentation screenshot targets produced by array map callbacks', () => {
    const arrayCallbackTargetSource = `
      await takeScreenshot(
        testInfo,
        [settingsSurface].map(() => page.locator('main')),
        page,
        'Mapped callback generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].flatMap(() => [page.locator('section')]),
        page,
        'Flat mapped broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].map(() => page.getByRole('button', { name: 'Save' })),
        page,
        'Mapped callback single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].flatMap(function () {
          return [page.locator('svg')];
        }),
        page,
        'Flat mapped icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/array-callback-target.doc.ts',
        arrayCallbackTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-callback-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/array-callback-target.doc.ts',
        arrayCallbackTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-callback-target.doc.ts:8:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/array-callback-target.doc.ts',
        arrayCallbackTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-callback-target.doc.ts:14:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/array-callback-target.doc.ts',
        arrayCallbackTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-callback-target.doc.ts:20:13']);
  });

  it('detects weak documentation screenshot targets produced by named array callbacks', () => {
    const namedArrayCallbackTargetSource = `
      function returnsGenericTarget() {
        return page.locator('main');
      }
      const returnsBroadTarget = () => [page.locator('section')];
      const returnsSingleControlTarget = () => page.getByRole('button', { name: 'Save' });
      const returnsIconTarget = function () {
        return [page.locator('svg')];
      };
      const aliasedIconTarget = returnsIconTarget;

      await takeScreenshot(
        testInfo,
        [settingsSurface].map(returnsGenericTarget),
        page,
        'Named callback generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].flatMap(returnsBroadTarget),
        page,
        'Named callback broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].map(returnsSingleControlTarget),
        page,
        'Named callback single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [settingsSurface].flatMap(aliasedIconTarget),
        page,
        'Aliased callback icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/named-array-callback-target.doc.ts',
        namedArrayCallbackTargetSource,
      ),
    ).toEqual(['tests/docs/example/named-array-callback-target.doc.ts:12:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/named-array-callback-target.doc.ts',
        namedArrayCallbackTargetSource,
      ),
    ).toEqual(['tests/docs/example/named-array-callback-target.doc.ts:18:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/named-array-callback-target.doc.ts',
        namedArrayCallbackTargetSource,
      ),
    ).toEqual(['tests/docs/example/named-array-callback-target.doc.ts:24:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/named-array-callback-target.doc.ts',
        namedArrayCallbackTargetSource,
      ),
    ).toEqual(['tests/docs/example/named-array-callback-target.doc.ts:30:13']);
  });

  it('detects weak documentation screenshot targets hidden behind branching expressions', () => {
    const branchingTargetSource = `
      const useFallback = true;
      const maybeSingleTarget = settingsSurface;
      const maybeIconTarget = settingsSurface;

      await takeScreenshot(
        testInfo,
        useFallback ? page.locator('main') : settingsSurface,
        page,
        'Conditional generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        settingsSurface ?? page.locator('section'),
        page,
        'Nullish broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        maybeSingleTarget || page.getByRole('button', { name: 'Save' }),
        page,
        'Logical single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        maybeIconTarget && page.locator('svg'),
        page,
        'Logical icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/branching-target.doc.ts',
        branchingTargetSource,
      ),
    ).toEqual(['tests/docs/example/branching-target.doc.ts:6:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/branching-target.doc.ts',
        branchingTargetSource,
      ),
    ).toEqual(['tests/docs/example/branching-target.doc.ts:12:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/branching-target.doc.ts',
        branchingTargetSource,
      ),
    ).toEqual(['tests/docs/example/branching-target.doc.ts:18:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/branching-target.doc.ts',
        branchingTargetSource,
      ),
    ).toEqual(['tests/docs/example/branching-target.doc.ts:24:13']);
  });

  it('detects weak documentation screenshot targets hidden behind nested branching expressions', () => {
    const nestedBranchingTargetSource = `
      const useFallback = true;
      const preferWeakTarget = true;

      await takeScreenshot(
        testInfo,
        useFallback ? (preferWeakTarget ? page.locator('main') : settingsSurface) : settingsSurface,
        page,
        'Nested conditional generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        settingsSurface ?? (preferWeakTarget ? page.locator('section') : settingsSurface),
        page,
        'Nested nullish broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        safeTarget || (preferWeakTarget ? page.getByRole('button', { name: 'Save' }) : settingsSurface),
        page,
        'Nested logical single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        safeTarget && (preferWeakTarget ? page.locator('svg') : settingsSurface),
        page,
        'Nested logical icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/nested-branching-target.doc.ts',
        nestedBranchingTargetSource,
      ),
    ).toEqual(['tests/docs/example/nested-branching-target.doc.ts:5:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/nested-branching-target.doc.ts',
        nestedBranchingTargetSource,
      ),
    ).toEqual(['tests/docs/example/nested-branching-target.doc.ts:11:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/nested-branching-target.doc.ts',
        nestedBranchingTargetSource,
      ),
    ).toEqual(['tests/docs/example/nested-branching-target.doc.ts:17:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/nested-branching-target.doc.ts',
        nestedBranchingTargetSource,
      ),
    ).toEqual(['tests/docs/example/nested-branching-target.doc.ts:23:13']);
  });

  it('detects weak documentation screenshot targets hidden behind non-null assertions', () => {
    const nonNullAssertionSource = `
      await takeScreenshot!(
        testInfo,
        page.locator('main')!,
        page,
        'Non-null generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('section')!,
        page,
        'Non-null broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.getByRole('button', { name: 'Save' })!,
        page,
        'Non-null single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('svg')!,
        page,
        'Non-null icon target with a descriptive caption',
      );
      await testInfo.attach!('image', { body: imageBuffer });
      await page.screenshot!({ path: 'page.png' });
    `;

    expect(
      countTakeScreenshotCalls(
        'tests/docs/example/non-null-target.doc.ts',
        nonNullAssertionSource,
      ),
    ).toBe(4);
    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/non-null-target.doc.ts',
        nonNullAssertionSource,
      ),
    ).toEqual(['tests/docs/example/non-null-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/non-null-target.doc.ts',
        nonNullAssertionSource,
      ),
    ).toEqual(['tests/docs/example/non-null-target.doc.ts:8:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/non-null-target.doc.ts',
        nonNullAssertionSource,
      ),
    ).toEqual(['tests/docs/example/non-null-target.doc.ts:14:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/non-null-target.doc.ts',
        nonNullAssertionSource,
      ),
    ).toEqual(['tests/docs/example/non-null-target.doc.ts:20:13']);
    expect(
      findDirectImageAttachmentCalls(
        'tests/docs/example/non-null-target.doc.ts',
        nonNullAssertionSource,
      ),
    ).toEqual(['tests/docs/example/non-null-target.doc.ts:26:13']);
    expect(
      findDirectScreenshotCalls(
        'tests/docs/example/non-null-target.doc.ts',
        nonNullAssertionSource,
      ),
    ).toEqual(['tests/docs/example/non-null-target.doc.ts:27:13']);
  });

  it('detects computed weak documentation screenshot target aliases', () => {
    const computedTargetSource = `
      const targets = {
        ['shell']: page.locator('main'),
        ['broad']: page.locator('section'),
        ['single']: page.getByRole('button', { name: 'Save' }),
        ['icon']: page.locator('svg'),
      };
      targets['assignedShell'] = page.locator('main');
      const { ['broad']: broadTarget } = targets;

      await takeScreenshot(
        testInfo,
        targets['shell'],
        page,
        'Computed generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        broadTarget,
        page,
        'Computed broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        targets['single'],
        page,
        'Computed single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        targets['icon'],
        page,
        'Computed icon target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        targets.assignedShell,
        page,
        'Computed assigned shell target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/computed-target.doc.ts',
        computedTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/computed-target.doc.ts:11:13',
      'tests/docs/example/computed-target.doc.ts:35:13',
    ]);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/computed-target.doc.ts',
        computedTargetSource,
      ),
    ).toEqual(['tests/docs/example/computed-target.doc.ts:17:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/computed-target.doc.ts',
        computedTargetSource,
      ),
    ).toEqual(['tests/docs/example/computed-target.doc.ts:23:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/computed-target.doc.ts',
        computedTargetSource,
      ),
    ).toEqual(['tests/docs/example/computed-target.doc.ts:29:13']);
  });

  it('detects grouped weak documentation screenshot target aliases', () => {
    const groupedTargetSource = `
      const shell = page.locator('main');
      const broad = page.locator('section');
      const single = page.getByRole('button', { name: 'Save' });
      const icon = page.locator('svg');
      const groupedTargets = {
        shell,
        broadAlias: broad,
        single,
        iconAlias: icon,
      };
      const indexedTargets = [shell, broad, single, icon];

      await takeScreenshot(
        testInfo,
        groupedTargets.shell,
        page,
        'Grouped shorthand generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        groupedTargets.broadAlias,
        page,
        'Grouped alias broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        groupedTargets.single,
        page,
        'Grouped shorthand single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        groupedTargets.iconAlias,
        page,
        'Grouped alias icon target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        indexedTargets[0],
        page,
        'Indexed generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        indexedTargets[1],
        page,
        'Indexed broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        indexedTargets[2],
        page,
        'Indexed single control target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        indexedTargets[3],
        page,
        'Indexed icon target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/grouped-target.doc.ts',
        groupedTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/grouped-target.doc.ts:14:13',
      'tests/docs/example/grouped-target.doc.ts:38:13',
    ]);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/grouped-target.doc.ts',
        groupedTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/grouped-target.doc.ts:20:13',
      'tests/docs/example/grouped-target.doc.ts:44:13',
    ]);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/grouped-target.doc.ts',
        groupedTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/grouped-target.doc.ts:26:13',
      'tests/docs/example/grouped-target.doc.ts:50:13',
    ]);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/grouped-target.doc.ts',
        groupedTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/grouped-target.doc.ts:32:13',
      'tests/docs/example/grouped-target.doc.ts:56:13',
    ]);
  });

  it('detects chained generic documentation screenshot targets', () => {
    const chainedGenericTargetSource = `
      await takeScreenshot(
        testInfo,
        page.locator('main').first(),
        page,
        'Chained generic main shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator('body').filter({ hasText: 'Settings' }),
        page,
        'Filtered generic body shell target with a descriptive caption',
      );
      const filteredShell = page.locator('app-root').filter({ hasText: 'Evorto' });
      await takeScreenshot(
        testInfo,
        filteredShell,
        page,
        'Aliased filtered app root shell target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/chained-generic-target.doc.ts',
        chainedGenericTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/chained-generic-target.doc.ts:2:13',
      'tests/docs/example/chained-generic-target.doc.ts:8:13',
      'tests/docs/example/chained-generic-target.doc.ts:15:13',
    ]);
  });

  it('detects template-literal weak documentation screenshot targets', () => {
    const templateLiteralTargetSource = `
      await takeScreenshot(
        testInfo,
        page.locator(\`main\`),
        page,
        'Template literal generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        page.locator(\`app-admin-overview\`),
        page,
        'Template literal broad host target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/template-literal-target.doc.ts',
        templateLiteralTargetSource,
      ),
    ).toEqual(['tests/docs/example/template-literal-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/template-literal-target.doc.ts',
        templateLiteralTargetSource,
      ),
    ).toEqual(['tests/docs/example/template-literal-target.doc.ts:8:13']);
  });

  it('detects weak documentation screenshot targets hidden behind flattened arrays', () => {
    const flattenedTargetSource = `
      await takeScreenshot(
        testInfo,
        [[page.locator('main')]].flat(),
        page,
        'Flattened generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [[page.locator('section')]].flat(),
        page,
        'Flattened broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [[page.getByRole('button', { name: 'Save' })]].flat(),
        page,
        'Flattened single button target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        [[page.locator('img[alt="Tenant logo"]')]].flat(),
        page,
        'Flattened image target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/flattened-target.doc.ts',
        flattenedTargetSource,
      ),
    ).toEqual(['tests/docs/example/flattened-target.doc.ts:2:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/flattened-target.doc.ts',
        flattenedTargetSource,
      ),
    ).toEqual(['tests/docs/example/flattened-target.doc.ts:8:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/flattened-target.doc.ts',
        flattenedTargetSource,
      ),
    ).toEqual(['tests/docs/example/flattened-target.doc.ts:14:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/flattened-target.doc.ts',
        flattenedTargetSource,
      ),
    ).toEqual(['tests/docs/example/flattened-target.doc.ts:20:13']);
  });

  it('detects weak documentation screenshot targets hidden behind static array accessors', () => {
    const arrayAccessorTargetSource = `
      const targetList = [
        page.locator('main'),
        page.locator('section'),
        page.getByRole('button', { name: 'Save' }),
        page.locator('img[alt="Tenant logo"]'),
      ];
      await takeScreenshot(
        testInfo,
        targetList.at(0),
        page,
        'Static array generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        targetList.at(1),
        page,
        'Static array broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        targetList.at(2),
        page,
        'Static array single button target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        targetList['at'](3),
        page,
        'Static array image target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/array-accessor-target.doc.ts',
        arrayAccessorTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-accessor-target.doc.ts:8:13']);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/array-accessor-target.doc.ts',
        arrayAccessorTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-accessor-target.doc.ts:14:13']);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/array-accessor-target.doc.ts',
        arrayAccessorTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-accessor-target.doc.ts:20:13']);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/array-accessor-target.doc.ts',
        arrayAccessorTargetSource,
      ),
    ).toEqual(['tests/docs/example/array-accessor-target.doc.ts:26:13']);
  });

  it('detects weak documentation screenshot targets hidden behind negative array accessors', () => {
    const negativeArrayAccessorTargetSource = `
      const genericTargets = [settingsSurface, page.locator('main')];
      const broadTargets = [settingsSurface, page.locator('section')];
      const singleTargets = [settingsSurface, page.getByRole('button', { name: 'Save' })];
      const iconTargets = [settingsSurface, page.locator('img[alt="Tenant logo"]')];
      await takeScreenshot(
        testInfo,
        genericTargets.at(-1),
        page,
        'Negative array generic shell target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        broadTargets.at(-1),
        page,
        'Negative array broad section target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        singleTargets.at(-1),
        page,
        'Negative array single button target with a descriptive caption',
      );
      await takeScreenshot(
        testInfo,
        iconTargets.at(-1),
        page,
        'Negative array image target with a descriptive caption',
      );
    `;

    expect(
      findGenericScreenshotTargets(
        'tests/docs/example/negative-array-accessor-target.doc.ts',
        negativeArrayAccessorTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/negative-array-accessor-target.doc.ts:6:13',
    ]);
    expect(
      findUnfilteredBroadScreenshotTargets(
        'tests/docs/example/negative-array-accessor-target.doc.ts',
        negativeArrayAccessorTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/negative-array-accessor-target.doc.ts:12:13',
    ]);
    expect(
      findSingleControlScreenshotTargets(
        'tests/docs/example/negative-array-accessor-target.doc.ts',
        negativeArrayAccessorTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/negative-array-accessor-target.doc.ts:18:13',
    ]);
    expect(
      findIconOrMediaScreenshotTargets(
        'tests/docs/example/negative-array-accessor-target.doc.ts',
        negativeArrayAccessorTargetSource,
      ),
    ).toEqual([
      'tests/docs/example/negative-array-accessor-target.doc.ts:24:13',
    ]);
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
      ['tests/docs/events/register.doc.ts', 14],
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
    const reporterAttachments = readSource(
      'tests/support/reporters/documentation-reporter/attachments.ts',
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
    expect(screenshotHelper).toContain('hasVisibleLoadingIndicator');
    expect(screenshotHelper).toContain(
      'return ![...document.body.querySelectorAll',
    );
    expect(screenshotHelper).toContain(
      'Documentation screenshots require a descriptive caption',
    );
    expect(screenshotHelper).toContain('at least 24 characters and four words');
    expect(reporterAttachments).toContain(
      'assertDescriptiveDocumentationCaption',
    );
    expect(reporterAttachments).toContain('minimumCaptionLength = 24');
    expect(reporterAttachments).toContain('minimumCaptionWordCount = 4');
    expect(reporterAttachments).toContain('minimumImageWidth = 320');
    expect(reporterAttachments).toContain('minimumImageHeight = 240');
    expect(reporterAttachments).toContain('minimumMarkdownBodyLength = 60');
    expect(reporterAttachments).toContain('png.width < minimumImageWidth');
    expect(reporterAttachments).toContain('png.height < minimumImageHeight');
    expect(reporterAttachments).toContain(
      'generated docs show enough UI context to judge the captured state',
    );
    expect(reporterAttachments).toContain('assertDescriptiveMarkdownBody');
    expect(reporterAttachments).toContain(
      'generated docs can be judged without clicking through the app',
    );
    expect(reporterAttachments).toContain(
      'Documentation image-caption attachment',
    );
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
    expect(
      readSource('tests/specs/reporting/reporter-paths.test.ts'),
    ).toContain(
      'documentation screenshot helper waits for all visible loading text',
    );
    expect(
      readSource('tests/specs/reporting/reporter-paths.test.ts'),
    ).toContain(
      'documentation reporter rejects weak image captions at output time',
    );
    expect(
      readSource('tests/specs/reporting/reporter-paths.test.ts'),
    ).toContain('documentation reporter rejects undersized image attachments');
    expect(
      readSource('tests/specs/reporting/reporter-paths.test.ts'),
    ).toContain('documentation reporter rejects weak markdown body text');

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
      expect(findRawMarkdownImageMarkup(path, source), path).toEqual([]);
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
    const importantProductDocumentationAreas = [
      {
        files: ['tests/docs/events/register.doc.ts'],
        productArea: 'browsing events',
        terms: ['browse the events', 'Events list'],
      },
      {
        files: ['tests/docs/events/register.doc.ts'],
        productArea: 'registering for events',
        terms: [
          'Register for a free event',
          'Successful registration',
          'Your event ticket',
          'QR code for the registration',
          'registration-confirmation email',
        ],
      },
      {
        files: ['tests/docs/events/register.doc.ts'],
        productArea: 'transferring a registration',
        terms: ['Transfer an unpaid registration', 'Transfer code'],
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
          'does not send the QR code directly',
          'Payment success, payment failure, and checkout expiry do not send separate email notifications',
          'registration-cancelled email',
          'spot-available email',
          'does not send a transfer-started email',
          'transfer-completed email',
          'does not send a receipt-submitted email',
          'queues the submitter email for delivery',
        ],
      },
    ] as const;

    const supplementalProductModelDocumentationAreas = [
      {
        files: [
          'tests/docs/events/register.doc.ts',
          'tests/docs/users/create-account.doc.ts',
        ],
        productArea: 'Registration requires an account.',
        terms: [
          'Account-required registration',
          'You can only register after logging in',
          'Log in now',
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
        productArea: 'use waitlists as lightweight demand indicators',
        terms: [
          'Full participant options expose a distinct **Join waitlist** action',
          'Leave waitlist',
        ],
      },
    ] as const;

    expect(
      extractMarkdownListAfter(
        productSource,
        'Important documentation areas include:',
      ),
    ).toEqual(
      importantProductDocumentationAreas.map(
        (documentationArea) => documentationArea.productArea,
      ),
    );

    for (const documentationArea of [
      ...importantProductDocumentationAreas,
      ...supplementalProductModelDocumentationAreas,
    ]) {
      expect(productSource).toContain(documentationArea.productArea);

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
    const qualityFeatureAreaDocumentationTopics = [
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
          'Payment success, payment failure, and checkout expiry do not send separate email notifications',
          'spot-available email',
          'does not send a transfer-started email',
          'transfer-completed email',
          'does not send a receipt-submitted email',
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

    const supplementalQualityJourneyDocumentationTopics = [
      {
        files: ['tests/docs/events/register.doc.ts'],
        terms: [
          'Your event ticket',
          'QR code for the registration',
          'registration-confirmation email',
        ],
        topic: 'receiving registration confirmation / QR code',
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
    ] as const;

    expect(
      extractMarkdownListAfter(
        qualitySource,
        'Organize generated docs by feature area, such as:',
      ),
    ).toEqual(
      qualityFeatureAreaDocumentationTopics.map(
        (documentationTopic) => documentationTopic.topic,
      ),
    );

    for (const documentationTopic of [
      ...qualityFeatureAreaDocumentationTopics,
      ...supplementalQualityJourneyDocumentationTopics,
    ]) {
      expect(qualitySource).toContain(`- ${documentationTopic.topic}`);

      const combinedSource = documentationTopic.files
        .map((file) => readSource(file))
        .join('\n');

      for (const term of documentationTopic.terms) {
        expect(combinedSource, documentationTopic.topic).toContain(term);
      }
    }
  });

  it('keeps documentation architecture represented by Playwright docs evidence', () => {
    const productSource = readSource('PRODUCT.md');
    const qualitySource = readSource('QUALITY.md');
    const architectureSource = readSource('ARCHITECTURE.md');
    const packageSource = readSource('package.json');
    const reporterSource = readSource(
      'tests/support/reporters/documentation-reporter/attachments.ts',
    );
    const screenshotHelperSource = readSource(
      'tests/support/reporters/documentation-reporter/take-screenshot.ts',
    );
    const docsFiles = findFiles('tests/docs')
      .filter((path) => path.endsWith('.doc.ts'))
      .toSorted();
    const docsSource = docsFiles.map((file) => readSource(file)).join('\n');
    const qualityFeatureAreaFolders = new Map([
      ['events', ['events']],
      ['templates', ['template-categories', 'templates']],
      ['registrations', ['events', 'users']],
      ['payments', ['events', 'finance', 'profile']],
      ['check-in', ['events']],
      ['roles and permissions', ['roles']],
      ['tenant settings', ['admin']],
      ['receipts', ['events', 'finance', 'profile']],
      ['email notifications', ['events', 'finance']],
      ['documentation/help', ['roles']],
    ]);
    const qualityDocumentationFeatureAreas = extractMarkdownListAfter(
      qualitySource,
      'Organize generated docs by feature area, such as:',
    );
    const expectedFeatureAreas = [
      ...new Set(
        qualityDocumentationFeatureAreas.flatMap(
          (featureArea) => qualityFeatureAreaFolders.get(featureArea) ?? [],
        ),
      ),
    ].toSorted();
    const featureAreas = [
      ...new Set(
        docsFiles.map((file) => file.split('/').at(2)).filter(Boolean),
      ),
    ].toSorted();

    expect(productSource).toContain(
      'Generated documentation is product-facing. It should be grouped by feature area and should not mix in internal testing examples.',
    );
    expect(architectureSource).toContain('generated user/admin documentation');
    expect(architectureSource).toContain(
      'screenshots and evidence for documented flows',
    );
    expect(architectureSource).toContain(
      'Use Playwright screenshots/docs as durable evidence.',
    );
    expect(architectureSource).toContain(
      'Playwright-generated documentation should be grouped by feature area, not by persona first.',
    );
    expect(architectureSource).toContain(
      'Feature-area grouping should align with test organization where practical.',
    );
    expect(packageSource).toContain('"test:e2e:docs"');
    expect(docsFiles.length).toBeGreaterThanOrEqual(16);
    expect([...qualityFeatureAreaFolders.keys()]).toEqual(
      qualityDocumentationFeatureAreas,
    );
    expect(featureAreas).toEqual(expectedFeatureAreas);
    expect(
      docsFiles.filter((file) =>
        /\/(?:example|internal|fixture)s?\//u.test(file),
      ),
    ).toEqual([]);
    expect(docsFiles).toContain('tests/docs/events/register.doc.ts');
    expect(docsFiles).toContain('tests/docs/admin/general-settings.doc.ts');
    expect(docsFiles).toContain('tests/docs/roles/about-permissions.doc.ts');
    expect(docsSource).toContain("testInfo.attach('markdown'");
    expect(docsSource).toContain('takeScreenshot(');
    expect(reporterSource).toContain('image-caption');
    expect(reporterSource).toContain('assertMeaningfulDocumentationImage');
    expect(screenshotHelperSource).toContain(
      'countDocumentationHighlightPixels',
    );
    expect(screenshotHelperSource).toContain('countDocumentationContentPixels');
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
    const productSource = readSource('PRODUCT.md');
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
    expect(source).toContain('const operationsPolicySettingsSurface =');
    expect(source).toContain('const brandAndSearchSettingsControls =');
    expect(source).toContain('const brandAndSearchSettingsSurface =');
    expect(source).toContain('const legalPageSettingsFields =');
    expect(source).toContain('const legalPageSettingsSurface =');
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
      'await expect(operationsPolicySettingsSurface).toBeVisible()',
    );
    expect(source).toContain(
      'for (const control of brandAndSearchSettingsControls)',
    );
    expect(source).toContain(
      'await expect(brandAndSearchSettingsSurface).toBeVisible()',
    );
    expect(source).toContain('for (const field of legalPageSettingsFields)');
    expect(source).toContain(
      'await expect(legalPageSettingsSurface).toBeVisible()',
    );
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
      'takeScreenshot(\n    testInfo,\n    operationsPolicySettingsSurface,',
    );
    expect(source).toContain(
      'const operationsPolicySettingsSurface = generalSettingsSection(page,',
    );
    expect(source).toContain("title: 'Operations policy'");
    expect(source).toContain("'Configure tenant-level operational defaults.'");
    expect(source).toContain("'Registration limit'");
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    operationsPolicySettingsFields,',
    );
    expect(source).toContain(
      'takeScreenshot(\n    testInfo,\n    brandAndSearchSettingsSurface,',
    );
    expect(source).toContain(
      'const brandAndSearchSettingsSurface = generalSettingsSection(page,',
    );
    expect(source).toContain("title: 'Brand assets'");
    expect(source).toContain(
      'takeScreenshot(\n    testInfo,\n    legalPageSettingsSurface,',
    );
    expect(source).toContain(
      'const legalPageSettingsSurface = generalSettingsSection(page,',
    );
    expect(source).toContain("title: 'Legal pages'");
    expect(source).toContain("'Hosted privacy policy text'");
    expect(source).toContain("'Hosted terms text'");
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    emailSenderField,',
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    hostedTermsField,',
    );
    expect(source).not.toContain(
      'takeScreenshot(\n    testInfo,\n    legalPageSettingsFields,',
    );
    expect(source).toContain(
      'Receipt and ESN card discount settings near the save action',
    );
    expect(source).toContain(
      'takeScreenshot(\n    testInfo,\n    financeAndDiscountSettingsSurface,',
    );
    expect(source).toContain(
      'const financeAndDiscountSettingsSurface = generalSettingsSection(page,',
    );
    expect(source).toContain("title: 'Finance settings'");
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
    expect(productSource).toContain(
      "Evorto should not provide fake fallback legal pages that pretend to cover a tenant's legal obligations.",
    );
    expect(source).not.toMatch(/fake fallback legal/i);
    expect(source).not.toMatch(/generic legal fallback/i);
    expect(source).not.toMatch(/production-ready legal/i);
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
    expect(unlistedUserSource).not.toMatch(/private invite[- ]only/i);
    expect(unlistedUserSource).not.toMatch(/invite[- ]only event/i);
    expect(unlistedUserSource).not.toMatch(/private event/i);
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
    const productSource = readSource('PRODUCT.md');
    const source = readSource('tests/docs/users/create-account.doc.ts');

    expect(productSource).toContain(
      'Users are global and may belong to multiple tenants.',
    );
    expect(productSource).toContain(
      'A user should ideally have a home tenant so the app can warn when they are browsing a tenant that is not where they usually belong.',
    );
    expect(productSource).toContain(
      'Default roles are assigned to users by default in that tenant.',
    );
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
    expect(source).not.toMatch(/one account per tenant/i);
    expect(source).not.toMatch(/tenant-specific login/i);
    expect(source).not.toMatch(/create a duplicate global user/i);
    expect(source).not.toMatch(
      /home tenant is optional for mismatch warnings/i,
    );
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
    const productSource = readSource('PRODUCT.md');
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
    expect(receiptSource).toContain(
      'Submitting a receipt does not send a receipt-submitted email in the current relaunch scope; the notification boundary starts when finance review is saved.',
    );
    expect(combinedSource).toContain(
      'Recording a reimbursement creates the Evorto finance transaction only.',
    );
    expect(combinedSource).toContain(
      'Transfer the money manually through the selected payout method.',
    );
    expect(combinedSource).toContain(
      'actual money movement remains a manual finance operation',
    );
    expect(productSource).toContain(
      '- sophisticated budgeting and receipt-category planning',
    );
    expect(productSource).toContain('- push notifications');
    expect(combinedSource).not.toMatch(/sophisticated budget/i);
    expect(combinedSource).not.toMatch(/receipt categor(y|ies)/i);
    expect(combinedSource).not.toMatch(/payout[- ]provider/i);
    expect(combinedSource).not.toMatch(/push notification/i);
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
    const productSource = readSource('PRODUCT.md');
    const source = readSource('tests/docs/finance/inclusive-tax-rates.doc.ts');

    expect(productSource).toContain(
      'Stripe is the source of truth for payment state.',
    );
    expect(productSource).toContain(
      'Evorto may duplicate relevant Stripe data locally for app behavior, reporting, and user experience',
    );
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
    expect(source).toContain(
      'Stripe remains the source of truth for tax-rate metadata.',
    );
    expect(source).toContain(
      'Evorto imports compatible rates from Stripe instead of asking admins to type local tax percentages by hand.',
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
    expect(source).not.toMatch(/manual tax percentage/i);
    expect(source).not.toMatch(/type (a|any|the) tax percentage/i);
    expect(source).not.toMatch(/custom local tax rate/i);
    expect(source).not.toMatch(/create tax rates? without Stripe/i);
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
    const productSource = readSource('PRODUCT.md');
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

    expect(productSource).toContain('Templates preserve organizational memory');
    expect(productSource).toContain(
      'Templates should preserve reusable event knowledge so future organizers do not start from scratch.',
    );
    expect(productSource).toContain(
      'Templates should include as much reusable information as practical',
    );
    expect(productSource).toContain(
      'organizer notes or checklist-like internal information',
    );
    expect(productSource).toContain(
      'An event instance is an editable copy of a template.',
    );
    expect(productSource).toContain(
      'Some duplication between templates and event instances is acceptable if it keeps event instances stable and understandable.',
    );
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
      'Everything you enter for a template will be the starting point for all events created from this template.',
    );
    expect(source).toContain('not shown on the public event page');
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
    expect(source).not.toMatch(/future organizers start from scratch/i);
    expect(source).not.toMatch(/template changes update existing events/i);
    expect(source).not.toMatch(/events stay linked to live template edits/i);
    expect(source).not.toMatch(
      /organizer notes shown on the public event page/i,
    );
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
    const productSource = readSource('PRODUCT.md');
    const source = readSource('tests/docs/events/register.doc.ts');

    expect(source).toContain('Review anonymous registration entry point');
    expect(productSource).toContain(
      'anonymous users may browse eligible listed events, but registration requires an account.',
    );
    expect(productSource).toContain(
      '- anonymous or guest registration without an account',
    );
    expect(productSource).toContain(
      "Guest spots are allowed as extra quantity attached to one logged-in buyer's registration.",
    );
    expect(productSource).toContain(
      'Guest spots do not need separate accounts or contact information in the first version.',
    );
    expect(productSource).toContain(
      'Registration options are mutually exclusive per event.',
    );
    expect(productSource).toContain(
      'A user cannot be both an organizer/helper and a participant for the same event.',
    );
    expect(productSource).toContain(
      'Registration options define role-based eligibility.',
    );
    expect(productSource).toContain(
      'Special cases such as banned users, ESN-card-only access, and participation in another program should be modeled through roles and registration-option eligibility.',
    );
    expect(productSource).toContain(
      'Stripe is the source of truth for payment state.',
    );
    expect(productSource).toContain(
      'Users should receive registration confirmation and QR code only after registration is successful. For paid events, that means after successful payment.',
    );
    expect(productSource).toContain(
      'QR links behave like paper tickets: possession of the unguessable ticket URL is enough to render the QR image so it can be included in email.',
    );
    expect(productSource).toContain(
      'Check-in must validate registration status and show enough attendee identity for organizers to confirm the right person is presenting the ticket.',
    );
    expect(source).toContain(
      'Anonymous visitors can browse listed public events, but registration stays account-required.',
    );
    expect(source).toContain('browser.newContext({ storageState: {} })');
    expect(source).toContain("'You can only register after logging in'");
    expect(source).toContain(
      '`/forward-login?redirectUrl=/events/${freeEventId}`',
    );
    expect(source).toContain(
      'Anonymous registration card with login-required action',
    );
    expect(source).toContain(
      'When a participant option is full, registration changes to a distinct **Join waitlist** action',
    );
    expect(source).toContain(
      'Waitlisted participants can return to the event page and use **Leave waitlist** before the event starts.',
    );
    expect(productSource).toContain(
      'They do not need to behave like a strict reservation queue.',
    );
    expect(source).not.toMatch(/strict reservation queue/i);
    expect(source).not.toMatch(/guaranteed reservation/i);
    expect(source).not.toMatch(/reserved waitlist spot/i);
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
    expect(source).toContain('Stripe.webhooks.generateTestHeaderString');
    expect(source).toContain("request.fetch('/webhooks/stripe'");
    expect(source).toContain(
      'Payment success, payment failure, and checkout expiry do not send separate email notifications in the current relaunch scope.',
    );
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
    expect(source).toContain(
      'Creating the transfer link does not send a transfer-started email; only a completed unpaid transfer queues a transfer-completed email.',
    );
    expect(source).toContain('fullOptionAfterLeaving.waitlistSpots');
    expect(productSource).toContain('- push notifications');
    expect(source).not.toMatch(/push notification/i);
    expect(source).not.toContain('Register button stays available');
    expect(source).not.toContain('paid transfers are automatic');
    expect(source).not.toContain('resale is automatic');
    expect(source).not.toContain(
      'Paid registration transfer and resale are not automatic yet.',
    );
    expect(source).not.toContain(
      'Resale listing workflows are not available yet.',
    );
    expect(source).not.toMatch(/anonymous (visitors|users) can register/i);
    expect(source).not.toMatch(/register without an account/i);
    expect(source).not.toMatch(/guest registration without an account/i);
    expect(source).not.toMatch(/guest (email|contact)/i);
    expect(source).not.toMatch(/separate guest account/i);
    expect(source).not.toMatch(/guest.*must create an account/i);
    expect(source).not.toMatch(
      /register as (both|a) participant and organizer/i,
    );
    expect(source).not.toMatch(/sign up as (both|a) participant and helper/i);
    expect(source).not.toMatch(
      /join the same event as participant and organizer/i,
    );
    expect(source).not.toMatch(/email[- ]domain eligibility/i);
    expect(source).not.toMatch(/invite[- ]code eligibility/i);
    expect(source).not.toMatch(/special[- ]case eligibility flag/i);
    expect(source).not.toMatch(/mark(s|ed)? .*paid locally/i);
    expect(source).not.toMatch(/simulate payment success without Stripe/i);
    expect(source).not.toMatch(/registration succeeds before payment/i);
    expect(source).not.toMatch(/QR code alone (is|is enough)/i);
    expect(source).not.toMatch(/check[- ]?in without validating/i);
    expect(source).not.toMatch(/check[- ]?in without attendee identity/i);
    expect(source).not.toContain('ticket QR code by email');
  });

  it('keeps event approval docs backed by deterministic lifecycle persistence checks', () => {
    const productSource = readSource('PRODUCT.md');
    const source = readSource('tests/docs/events/event-approval.doc.ts');

    expect(productSource).toContain('## Event Lifecycle');
    expect(productSource).toContain('- `draft`');
    expect(productSource).toContain('- `pending review`');
    expect(productSource).toContain('- `published`');
    expect(productSource).toContain(
      'When an event is submitted for review, material fields should be locked.',
    );
    expect(productSource).toContain(
      'Publishing is the approval act. There is no separate "approved but not published" state for now.',
    );
    expect(productSource).toContain(
      'material changes should require returning the event to draft',
    );
    expect(source).toContain('Approval Flow ${seedDate.getTime()}');
    expect(source).toContain('Expected generated approval docs event to exist');
    expect(source).toContain('const eventStatusSurface =');
    expect(source).toContain('const submitForReviewDialogSurface =');
    expect(source).toContain('const rejectEventDialogSurface =');
    expect(source).toContain('The user-facing event publishing lifecycle is:');
    expect(source).toContain('Publishing is the approval act.');
    expect(source).toContain(
      'There is no separate approved-but-unpublished state in the relaunch workflow.',
    );
    expect(source).toContain(
      'Pending review locks material event editing until the event is approved or rejected.',
    );
    expect(source).toContain(
      'Reviewers use the review action surface to approve or reject with feedback; they do not edit material event fields from that review action.',
    );
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
    expect(source).toContain(
      'Approving publishes the event and stores the final status as **APPROVED**.',
    );
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
    expect(source).not.toMatch(/approved but not published/i);
    expect(source).not.toMatch(/approved but not yet published/i);
    expect(source).not.toMatch(/approved separately before publishing/i);
    expect(source).not.toMatch(/manual publishing after approval/i);
    expect(source).not.toMatch(/approved state before publishing/i);
    expect(source).not.toMatch(/reviewers? can edit (pending|material)/i);
    expect(source).not.toMatch(/edit material event fields during review/i);
    expect(source).toContain('.delete(schema.eventRegistrationOptions)');
    expect(source).toContain('.delete(schema.eventInstances)');
    expect(source).not.toContain(
      'Approval Flow ${seedDate.toISOString().slice(0, 10)}',
    );
  });

  it('keeps event-management docs aligned with scanner and organizer scope', () => {
    const productSource = readSource('PRODUCT.md');
    const source = readSource('tests/docs/events/event-management.doc.ts');

    expect(productSource).toContain(
      'QR links behave like paper tickets: possession of the unguessable ticket URL is enough to render the QR image so it can be included in email.',
    );
    expect(productSource).toContain(
      'Check-in must validate registration status and show enough attendee identity for organizers to confirm the right person is presenting the ticket.',
    );
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
    expect(source).toContain('Attendees open their ticket QR code');
    expect(source).toContain('after a confirmed registration');
    expect(source).toContain('shows the attendee, event, registration option');
    expect(source).toContain('warnings for self-scan');
    expect(source).toContain('non-confirmed registrations');
    expect(source).toContain('already checked-in tickets');
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
    expect(source).not.toMatch(/QR code alone (is|is enough)/i);
    expect(source).not.toMatch(/check[- ]?in without validating/i);
    expect(source).not.toMatch(/check[- ]?in without attendee identity/i);
    expect(source).not.toMatch(/skip(s|ped)? registration status/i);
    expect(source).not.toMatch(/anonymous QR check[- ]?in/i);
    expect(source).not.toContain('managing attendees');
    expect(source).not.toContain('automatic refund controls are available');
    expect(source).not.toContain('paid registration transfer is available');
    expect(source).not.toContain('event-cancelled email');
    expect(source).not.toContain('event cancellation workflow');
    expect(source).not.toContain('Cancel event');
    expect(source).not.toContain('cancel the event');
  });

  it('keeps role docs aligned with generated permission reference semantics', () => {
    const productSource = readSource('PRODUCT.md');
    const rolesSource = readSource('tests/docs/roles/roles.doc.ts');
    const permissionsSource = readSource(
      'tests/docs/roles/about-permissions.doc.ts',
    );

    expect(productSource).toContain('- manage roles');
    expect(productSource).toContain(
      'Tenants can define their own roles. There is no single system-defined default role.',
    );
    expect(productSource).toContain(
      'Instead, roles can be marked as default by the tenant.',
    );
    expect(productSource).toContain(
      'Permissions should be modeled as capabilities.',
    );
    expect(productSource).toContain(
      'Agents must not bypass capability checks or make authorization behavior more permissive for convenience.',
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
      'Assigning roles to existing users is explicitly deferred for relaunch.',
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
    expect(rolesSource).toContain(
      '**Default user role**: This role will be assigned to all new users.',
    );
    expect(rolesSource).toContain(
      '**Default organizer role**: This role will be automatically included in the allowed roles of an organizer registration.',
    );
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
    expect(rolesSource).not.toMatch(/can assign roles to existing users/i);
    expect(rolesSource).not.toMatch(/assign roles from the all users page/i);
    expect(rolesSource).not.toMatch(/system-defined default role/i);
    expect(rolesSource).not.toMatch(/built-in default role/i);
    expect(rolesSource).not.toMatch(/global default role/i);
    expect(rolesSource).not.toContain(
      "getByRole('button', { name: 'Assign roles' })",
    );
    expect(rolesSource).not.toContain(
      "getByRole('button', { name: 'Edit roles' })",
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
    expect(permissionsSource).not.toMatch(/system-defined default role/i);
    expect(permissionsSource).not.toMatch(/global default role/i);
  });

  it('keeps ESN discount docs aligned with provider-error and write-guard behavior', () => {
    const productSource = readSource('PRODUCT.md');
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
    expect(productSource).toContain(
      'ESN-card behavior should be opt-in because not every tenant is an ESN section.',
    );
    expect(source).not.toMatch(/every tenant/i);
    expect(source).not.toMatch(/all tenants/i);
    expect(source).not.toMatch(/hard[- ]coded ESN/i);
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
