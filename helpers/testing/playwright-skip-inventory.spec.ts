import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// Source guard: every skipped browser/doc test needs an explicit reason here so
// uncovered behavior does not disappear behind permanent `test.skip` calls.
const repositoryRoot = new URL('../..', import.meta.url).pathname;
const testsRoot = path.join(repositoryRoot, 'tests');
const testInventoryPath = path.join(testsRoot, 'test-inventory.md');

const allowedPlaywrightSkipEntries = [
  {
    entry: 'tests/docs/users/create-account.doc.ts:136:test.skip',
    reason:
      'Auth0 Management credentials are required for the integration doc.',
  },
  {
    entry: 'tests/specs/profile/create-account.spec.ts:23:test.skip',
    reason:
      'Auth0 Management credentials are required for create-account integration coverage.',
  },
  {
    entry: 'tests/specs/finance/stripe-webhook-replay.spec.ts:19:test.skip',
    reason: 'A Stripe webhook signing secret is required for replay coverage.',
    requiredEnvironment: ['STRIPE_WEBHOOK_SECRET'],
  },
] as const;

const allowedPlaywrightRuntimeModifierEntries = [
  {
    entry: 'tests/docs/events/register.doc.ts:182:test.describe.configure',
    reason:
      'The registration documentation flow runs serially with one retry because it mutates shared event registration state while proving the full free/paid journey.',
  },
  {
    entry: 'tests/docs/events/register.doc.ts:239:test.slow',
    reason:
      'The free registration documentation flow performs Auth0 login, event navigation, database readbacks, and generated-doc attachments.',
  },
  {
    entry: 'tests/docs/events/register.doc.ts:1051:test.slow',
    reason:
      'The paid registration documentation flow performs Stripe checkout replay, webhook delivery, database readbacks, and generated-doc attachments.',
  },
] as const;

const allowedEntries = new Set(
  allowedPlaywrightSkipEntries.map((entry) => entry.entry),
);

const playwrightDescribeAccessPattern = String.raw`(?:\s*\.\s*describe|\s*\[\s*['"]describe['"]\s*\])`;
const playwrightCallablePattern = new RegExp(
  String.raw`\b(?:test(?:${playwrightDescribeAccessPattern})?|it|describe)`,
  'u',
);
const playwrightModifierAccessPattern = (names: string): string =>
  String.raw`(?:\s*\.\s*(?:${names})\b|\s*\[\s*['"](?:${names})['"]\s*\])`;
const playwrightModifierAccessCapturePattern = (names: string): string =>
  String.raw`(?:\s*\.\s*(?<dotModifier>${names})\b|\s*\[\s*['"](?<bracketModifier>${names})['"]\s*\])`;
const identifierPattern = String.raw`[A-Za-z_$][\w$]*`;
const staticStringAssignmentPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s+(?<alias>${identifierPattern})\s*=\s*(?<expression>[^;\n]+)`,
  'g',
);
const staticStringTokenPattern = new RegExp(
  String.raw`^\s*(?:'(?<single>[^']*)'|"(?<double>[^"]*)"|(?<alias>${identifierPattern}))\s*$`,
  'u',
);
const playwrightModifierAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s+(?<alias>${identifierPattern})\s*=\s*test(?:${playwrightDescribeAccessPattern})?${playwrightModifierAccessCapturePattern('skip|fixme|only|slow|configure')}`,
  'g',
);
const playwrightStaticPropertyModifierAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s+(?<alias>${identifierPattern})\s*=\s*test(?:${playwrightDescribeAccessPattern})?\s*\[\s*(?<modifierAlias>${identifierPattern})\s*\]`,
  'g',
);
const pageMethodAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s+(?<alias>${identifierPattern})\s*=\s*page${playwrightModifierAccessCapturePattern('pause|waitForTimeout')}`,
  'g',
);
const pageStaticPropertyMethodAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s+(?<alias>${identifierPattern})\s*=\s*page\s*\[\s*(?<methodAlias>${identifierPattern})\s*\]`,
  'g',
);
const pageMethodIndirectInvocationPattern = (names: string): RegExp =>
  new RegExp(
    String.raw`\bpage${playwrightModifierAccessPattern(names)}\s*(?:\.\s*(?:call|apply|bind)\b|\[\s*['"](?:call|apply|bind)['"]\s*\])`,
    'g',
  );
const playwrightDestructuredModifierAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s*\{(?<bindings>[^}]+)\}\s*=\s*test(?:${playwrightDescribeAccessPattern})?`,
  'g',
);
const playwrightNestedDescribeModifierAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s*\{[^{}]*\bdescribe\s*:\s*\{(?<bindings>[^}]+)\}[^{}]*\}\s*=\s*test\b`,
  'g',
);
const playwrightObjectRestModifierAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s*\{(?<bindings>[^{}]*\.\.\.\s*(?<alias>${identifierPattern})[^{}]*)\}\s*=\s*(?<owner>test(?:${playwrightDescribeAccessPattern})?)\b`,
  'g',
);
const playwrightCopiedModifierObjectAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s+(?<alias>${identifierPattern})\s*=\s*(?:\{\s*\.\.\.\s*(?<spreadOwner>test(?:${playwrightDescribeAccessPattern})?)\s*\}|Object\.assign\(\s*\{\s*\}\s*,\s*(?<assignedOwner>test(?:${playwrightDescribeAccessPattern})?)\s*\))`,
  'g',
);
const pageDestructuredMethodAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s*\{(?<bindings>[^}]+)\}\s*=\s*page\b`,
  'g',
);
const pageObjectRestMethodAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s*\{(?<bindings>[^{}]*\.\.\.\s*(?<alias>${identifierPattern})[^{}]*)\}\s*=\s*page\b`,
  'g',
);
const pageCopiedMethodObjectAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s+(?<alias>${identifierPattern})\s*=\s*(?:\{\s*\.\.\.\s*page\s*\}|Object\.assign\(\s*\{\s*\}\s*,\s*page\s*\))`,
  'g',
);
const destructuredModifierBindingPattern = new RegExp(
  String.raw`^(?<modifier>skip|fixme|only|slow|configure)\b(?:\s*:\s*(?<alias>${identifierPattern}))?`,
  'u',
);
const destructuredPageMethodBindingPattern = new RegExp(
  String.raw`^(?<method>pause|waitForTimeout)\b(?:\s*:\s*(?<alias>${identifierPattern}))?`,
  'u',
);
const skipPattern = new RegExp(
  String.raw`${playwrightCallablePattern.source}${playwrightModifierAccessPattern('skip|fixme')}`,
  'g',
);
const runtimeModifierPattern = new RegExp(
  String.raw`\b(?:test${playwrightDescribeAccessPattern}${playwrightModifierAccessPattern('configure')}|test${playwrightModifierAccessPattern('slow')})`,
  'g',
);
const focusedOnlyPattern = new RegExp(
  String.raw`${playwrightCallablePattern.source}${playwrightModifierAccessPattern('only')}`,
  'g',
);
const callStartPattern = String.raw`\s*\(`;
const interactiveDebugPattern = new RegExp(
  String.raw`\bdebugger\b|\bpage${playwrightModifierAccessPattern('pause')}${callStartPattern}`,
  'g',
);
const placeholderMetadataPattern = /@(track|req|doc)\(/g;
const fixedWaitPattern = new RegExp(
  String.raw`${playwrightModifierAccessPattern('waitForTimeout')}${callStartPattern}`,
  'g',
);
const screenshotHelperFixedSleepPattern = new RegExp(
  String.raw`\bsetTimeout${callStartPattern}`,
  'g',
);
const screenshotHelperPaths = [
  'tests/support/reporters/documentation-reporter/take-screenshot.ts',
  'tests/support/utils/doc-screenshot.ts',
] as const;

const allowedPlaceholderMetadataFiles = new Set([
  'tests/specs/reporting/reporter-paths.test.ts',
]);

const collectTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectTypeScriptFiles(entryPath);
    }

    return entry.isFile() && entryPath.endsWith('.ts') ? [entryPath] : [];
  });

const collectPlaywrightSpecAndDocumentFiles = () =>
  collectTypeScriptFiles(testsRoot)
    .map((filePath) => path.relative(testsRoot, filePath).replaceAll('\\', '/'))
    .filter(
      (path) =>
        (path.startsWith('docs/') || path.startsWith('specs/')) &&
        (path.endsWith('.doc.ts') ||
          path.endsWith('.spec.ts') ||
          path.endsWith('.test.ts')),
    );

const collectActiveInventoryFiles = () => {
  const source = readFileSync(testInventoryPath, 'utf8');
  const activeFilesSection = source.match(
    /## Active Files\n(?<section>[\s\S]*?)\n## Suite Ownership/,
  )?.groups?.section;

  if (activeFilesSection === undefined) {
    throw new Error('tests/test-inventory.md is missing the Active Files list');
  }

  return activeFilesSection
    .split('\n')
    .map(
      (line) =>
        line.match(/^\s{2}- (?<path>(?:docs|specs)\/\S+)/)?.groups?.path,
    )
    .filter((path): path is string => path !== undefined);
};

const lineNumberForOffset = (source: string, offset: number): number =>
  source.slice(0, offset).split('\n').length;

const formatPatternMatch = (matchText: string): string =>
  matchText.replace(/\s+/gu, ' ').trim();

const escapeRegExp = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

const collectPatternEntriesForSource = (
  relativePath: string,
  source: string,
  pattern: RegExp,
) =>
  [...source.matchAll(pattern)].map((match) => {
    const offset = match.index ?? 0;
    return `${relativePath}:${lineNumberForOffset(source, offset)}:${formatPatternMatch(match[0])}`.replaceAll(
      '\\',
      '/',
    );
  });

const resolveStaticStringExpression = (
  expression: string,
  aliases: ReadonlyMap<string, string>,
): string | undefined => {
  const trimmedExpression = expression.trim();
  const joinMatch = trimmedExpression.match(
    /^(?<receiver>.+)\.join\(\s*(?<separator>(?:'[^']*'|"[^"]*"))?\s*\)$/u,
  );

  if (joinMatch?.groups !== undefined) {
    const values = resolveStaticStringArrayExpression(
      joinMatch.groups.receiver,
      aliases,
    );
    const separator =
      joinMatch.groups.separator === undefined
        ? ','
        : resolveStaticStringExpression(joinMatch.groups.separator, aliases);

    return values !== undefined && separator !== undefined
      ? values.join(separator)
      : undefined;
  }

  const parts = expression.split('+');
  let value = '';

  for (const part of parts) {
    const match = part.match(staticStringTokenPattern);

    if (!match?.groups) {
      return undefined;
    }

    const staticPart =
      match.groups.single ??
      match.groups.double ??
      aliases.get(match.groups.alias ?? '');

    if (staticPart === undefined) {
      return undefined;
    }

    value += staticPart;
  }

  return value;
};

const resolveStaticStringArrayExpression = (
  expression: string,
  aliases: ReadonlyMap<string, string>,
): string[] | undefined => {
  const trimmedExpression = expression.trim();
  const concatMatch = trimmedExpression.match(
    /^(?<receiver>.+)\.concat\((?<arguments>.*)\)$/u,
  );

  if (concatMatch?.groups !== undefined) {
    const values = resolveStaticStringArrayExpression(
      concatMatch.groups.receiver,
      aliases,
    );

    if (values === undefined) {
      return undefined;
    }

    const argumentValues: string[] = [];

    for (const argument of splitStaticArrayElements(
      concatMatch.groups.arguments,
    )) {
      const arrayValues = resolveStaticStringArrayExpression(argument, aliases);

      if (arrayValues !== undefined) {
        argumentValues.push(...arrayValues);
        continue;
      }

      const value = resolveStaticStringExpression(argument, aliases);

      if (value === undefined) {
        return undefined;
      }

      argumentValues.push(value);
    }

    return [...values, ...argumentValues];
  }

  if (!trimmedExpression.startsWith('[') || !trimmedExpression.endsWith(']')) {
    return undefined;
  }

  const elements = splitStaticArrayElements(trimmedExpression.slice(1, -1));
  const values = elements.map((element) =>
    resolveStaticStringExpression(element, aliases),
  );

  return values.every((value): value is string => value !== undefined)
    ? values
    : undefined;
};

const splitStaticArrayElements = (source: string): string[] => {
  const elements: string[] = [];
  let current = '';
  let depth = 0;
  let quote: '"' | "'" | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const previous = source[index - 1];

    if ((character === '"' || character === "'") && previous !== '\\') {
      quote = quote === character ? null : (quote ?? character);
    } else if (quote === null && character === '[') {
      depth += 1;
    } else if (quote === null && character === ']') {
      depth -= 1;
    } else if (quote === null && depth === 0 && character === ',') {
      if (current.trim()) {
        elements.push(current.trim());
      }

      current = '';
      continue;
    }

    current += character;
  }

  if (current.trim()) {
    elements.push(current.trim());
  }

  return elements;
};

const collectStaticStringAliases = (
  source: string,
): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>();
  let changed = true;

  while (changed) {
    changed = false;

    for (const match of source.matchAll(staticStringAssignmentPattern)) {
      const alias = match.groups?.alias;
      const expression = match.groups?.expression;

      if (alias === undefined || expression === undefined) {
        continue;
      }

      const value = resolveStaticStringExpression(expression, aliases);

      if (value !== undefined && !aliases.has(alias)) {
        aliases.set(alias, value);
        changed = true;
      }
    }
  }

  return aliases;
};

const collectReflectAliases = (source: string): ReadonlySet<string> => {
  const aliases = new Set<string>();
  const reflectAliasPattern = new RegExp(
    String.raw`\b(?:const|let|var)\s+(?<alias>${identifierPattern})\s*=\s*(?<source>${identifierPattern})\b`,
    'g',
  );
  let changed = true;

  while (changed) {
    changed = false;

    for (const match of source.matchAll(reflectAliasPattern)) {
      const alias = match.groups?.alias;
      const sourceName = match.groups?.source;

      if (
        alias !== undefined &&
        sourceName !== undefined &&
        (sourceName === 'Reflect' || aliases.has(sourceName)) &&
        !aliases.has(alias)
      ) {
        aliases.add(alias);
        changed = true;
      }
    }
  }

  return aliases;
};

const collectStaticPropertyEntriesForSource = (
  relativePath: string,
  source: string,
  ownerPattern: string,
  names: readonly string[],
) => {
  const aliases = collectStaticStringAliases(source);
  const allowedNames = new Set(names);
  const staticPropertyPattern = new RegExp(
    String.raw`${ownerPattern}\s*\[\s*(?<propertyAlias>${identifierPattern})\s*\]\s*(?:\(|\.\s*(?:call|apply|bind)\b|\[\s*['"](?:call|apply|bind)['"]\s*\])`,
    'g',
  );

  return [...source.matchAll(staticPropertyPattern)].flatMap((match) => {
    const propertyAlias = match.groups?.propertyAlias;
    const propertyName =
      propertyAlias === undefined ? undefined : aliases.get(propertyAlias);

    if (propertyName === undefined || !allowedNames.has(propertyName)) {
      return [];
    }

    const offset = match.index ?? 0;

    return `${relativePath}:${lineNumberForOffset(source, offset)}:${formatPatternMatch(match[0])} (${propertyName} property alias)`.replaceAll(
      '\\',
      '/',
    );
  });
};

const collectReflectPropertyEntriesForSource = (
  relativePath: string,
  source: string,
  ownerPattern: string,
  names: readonly string[],
) => {
  const allowedNames = new Set(names);
  const staticStringAliases = collectStaticStringAliases(source);
  const reflectAliases = collectReflectAliases(source);
  const reflectOwnerPattern = String.raw`(?:Reflect${
    reflectAliases.size > 0
      ? `|${[...reflectAliases].map(escapeRegExp).join('|')}`
      : ''
  })`;
  const reflectGetAccessPattern = String.raw`${reflectOwnerPattern}\s*(?:\.\s*get\b|\[\s*['"]get['"]\s*\])`;
  const reflectApplyAccessPattern = String.raw`${reflectOwnerPattern}\s*(?:\.\s*apply\b|\[\s*['"]apply['"]\s*\])`;
  const reflectedPropertyExpressionPattern = String.raw`(?<property>(?:'[^']*'|"[^"]*"|${identifierPattern}(?:\s*\+\s*(?:'[^']*'|"[^"]*"|${identifierPattern}))*))`;
  const directReflectGetPattern = new RegExp(
    String.raw`\b${reflectGetAccessPattern}\s*\(\s*${ownerPattern}\s*,\s*${reflectedPropertyExpressionPattern}\s*\)\s*(?:\(|\.\s*(?:call|apply|bind)\b|\[\s*['"](?:call|apply|bind)['"]\s*\])`,
    'g',
  );
  const reflectGetAliasPattern = new RegExp(
    String.raw`\b(?:const|let|var)\s+(?<alias>${identifierPattern})\s*=\s*${reflectGetAccessPattern}\s*\(\s*${ownerPattern}\s*,\s*${reflectedPropertyExpressionPattern}\s*\)`,
    'g',
  );
  const reflectApplyPropertyPattern = new RegExp(
    String.raw`\b${reflectApplyAccessPattern}\s*\(\s*${ownerPattern}${playwrightModifierAccessPattern(
      names.map(escapeRegExp).join('|'),
    )}`,
    'g',
  );
  const reflectApplyGetPattern = new RegExp(
    String.raw`\b${reflectApplyAccessPattern}\s*\(\s*${reflectGetAccessPattern}\s*\(\s*${ownerPattern}\s*,\s*${reflectedPropertyExpressionPattern}\s*\)`,
    'g',
  );

  const resolvePropertyName = (expression: string): string | undefined =>
    resolveStaticStringExpression(expression, staticStringAliases);

  const directEntries = [
    ...[...source.matchAll(directReflectGetPattern)].flatMap((match) => {
      const propertyName = resolvePropertyName(match.groups?.property ?? '');

      if (propertyName === undefined || !allowedNames.has(propertyName)) {
        return [];
      }

      const offset = match.index ?? 0;

      return `${relativePath}:${lineNumberForOffset(source, offset)}:${formatPatternMatch(match[0])} (${propertyName} Reflect.get)`.replaceAll(
        '\\',
        '/',
      );
    }),
    ...[...source.matchAll(reflectApplyPropertyPattern)].map((match) => {
      const offset = match.index ?? 0;

      return `${relativePath}:${lineNumberForOffset(source, offset)}:${formatPatternMatch(match[0])} (Reflect.apply)`.replaceAll(
        '\\',
        '/',
      );
    }),
    ...[...source.matchAll(reflectApplyGetPattern)].flatMap((match) => {
      const propertyName = resolvePropertyName(match.groups?.property ?? '');

      if (propertyName === undefined || !allowedNames.has(propertyName)) {
        return [];
      }

      const offset = match.index ?? 0;

      return `${relativePath}:${lineNumberForOffset(source, offset)}:${formatPatternMatch(match[0])} (${propertyName} Reflect.apply get)`.replaceAll(
        '\\',
        '/',
      );
    }),
  ];

  const reflectedAliases = new Map<string, string>();

  for (const match of source.matchAll(reflectGetAliasPattern)) {
    const alias = match.groups?.alias;
    const propertyName = resolvePropertyName(match.groups?.property ?? '');

    if (
      alias !== undefined &&
      propertyName !== undefined &&
      allowedNames.has(propertyName)
    ) {
      reflectedAliases.set(alias, propertyName);
    }
  }

  const aliasEntries = [...reflectedAliases.entries()].flatMap(
    ([alias, propertyName]) => {
      const aliasCallPattern = new RegExp(
        String.raw`\b${escapeRegExp(alias)}\s*\(`,
        'g',
      );

      return collectPatternEntriesForSource(
        relativePath,
        source,
        aliasCallPattern,
      )
        .filter((entry) => !entry.includes(`:${alias} =`))
        .map((entry) => `${entry} (${propertyName} Reflect.get alias)`);
    },
  );

  return [...directEntries, ...aliasEntries];
};

const collectPatternEntries = (pattern: RegExp) =>
  collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectPatternEntriesForSource(relativePath, source, pattern);
  });

const collectObjectRestPropertyEntriesForSource = (
  relativePath: string,
  source: string,
  ownerAlias: string,
  ownerDescription: string,
  names: readonly string[],
  aliasDescription = 'object-rest alias',
) => {
  const allowedNames = new Set(names);
  const staticStringAliases = collectStaticStringAliases(source);
  const directPropertyPattern = new RegExp(
    String.raw`\b${escapeRegExp(ownerAlias)}\s*(?:\.\s*(?<dotProperty>${names
      .map(escapeRegExp)
      .join(
        '|',
      )})\b|\[\s*(?<bracketProperty>(?:'[^']*'|"[^"]*"|${identifierPattern}))\s*\])\s*(?:\(|\.\s*(?:call|apply|bind)\b|\[\s*['"](?:call|apply|bind)['"]\s*\])`,
    'g',
  );

  return [...source.matchAll(directPropertyPattern)].flatMap((match) => {
    const propertyName =
      match.groups?.dotProperty ??
      resolveStaticStringExpression(
        match.groups?.bracketProperty ?? '',
        staticStringAliases,
      );

    if (propertyName === undefined || !allowedNames.has(propertyName)) {
      return [];
    }

    const offset = match.index ?? 0;

    return `${relativePath}:${lineNumberForOffset(source, offset)}:${formatPatternMatch(match[0])} (${ownerDescription}.${propertyName} ${aliasDescription})`.replaceAll(
      '\\',
      '/',
    );
  });
};

const modifierForAliasMatch = (match: RegExpExecArray): string | undefined =>
  match.groups?.dotModifier ?? match.groups?.bracketModifier;

const collectAliasedModifierEntriesForSource = (
  relativePath: string,
  source: string,
  modifiers: readonly string[],
) => {
  const allowedModifiers = new Set(modifiers);
  const staticStringAliases = collectStaticStringAliases(source);
  const aliases = new Map<string, string>();

  for (const match of source.matchAll(playwrightModifierAliasPattern)) {
    const alias = match.groups?.alias;
    const modifier = modifierForAliasMatch(match);

    if (
      alias !== undefined &&
      modifier !== undefined &&
      allowedModifiers.has(modifier)
    ) {
      aliases.set(alias, modifier);
    }
  }

  for (const match of source.matchAll(
    playwrightStaticPropertyModifierAliasPattern,
  )) {
    const alias = match.groups?.alias;
    const modifierAlias = match.groups?.modifierAlias;
    const modifier =
      modifierAlias === undefined
        ? undefined
        : staticStringAliases.get(modifierAlias);

    if (
      alias !== undefined &&
      modifier !== undefined &&
      allowedModifiers.has(modifier)
    ) {
      aliases.set(alias, modifier);
    }
  }

  for (const match of source.matchAll(
    playwrightDestructuredModifierAliasPattern,
  )) {
    const bindings = match.groups?.bindings;

    if (bindings === undefined) {
      continue;
    }

    for (const binding of bindings.split(',')) {
      const bindingMatch = binding
        .trim()
        .match(destructuredModifierBindingPattern);
      const modifier = bindingMatch?.groups?.modifier;
      const alias = bindingMatch?.groups?.alias ?? modifier;

      if (
        alias !== undefined &&
        modifier !== undefined &&
        allowedModifiers.has(modifier)
      ) {
        aliases.set(alias, modifier);
      }
    }
  }

  for (const match of source.matchAll(
    playwrightNestedDescribeModifierAliasPattern,
  )) {
    const bindings = match.groups?.bindings;

    if (bindings === undefined) {
      continue;
    }

    for (const binding of bindings.split(',')) {
      const bindingMatch = binding
        .trim()
        .match(destructuredModifierBindingPattern);
      const modifier = bindingMatch?.groups?.modifier;
      const alias = bindingMatch?.groups?.alias ?? modifier;

      if (
        alias !== undefined &&
        modifier !== undefined &&
        allowedModifiers.has(modifier)
      ) {
        aliases.set(alias, modifier);
      }
    }
  }

  const aliasEntries = [...aliases.entries()].flatMap(([alias, modifier]) => {
    const aliasCallPattern = new RegExp(
      String.raw`\b${escapeRegExp(alias)}\s*\(`,
      'g',
    );

    return collectPatternEntriesForSource(
      relativePath,
      source,
      aliasCallPattern,
    )
      .filter((entry) => !entry.includes(`:${alias} =`))
      .map((entry) => `${entry} (${modifier} alias)`);
  });

  const objectRestEntries = [
    ...source.matchAll(playwrightObjectRestModifierAliasPattern),
  ].flatMap((match) => {
    const owner = match.groups?.owner;
    const alias = match.groups?.alias;

    if (alias === undefined || owner === undefined) {
      return [];
    }

    const ownerDescription = owner.includes('describe')
      ? 'test.describe'
      : 'test';

    return collectObjectRestPropertyEntriesForSource(
      relativePath,
      source,
      alias,
      ownerDescription,
      modifiers,
    );
  });

  const copiedObjectEntries = [
    ...source.matchAll(playwrightCopiedModifierObjectAliasPattern),
  ].flatMap((match) => {
    const alias = match.groups?.alias;
    const owner = match.groups?.spreadOwner ?? match.groups?.assignedOwner;

    if (alias === undefined || owner === undefined) {
      return [];
    }

    const ownerDescription = owner.includes('describe')
      ? 'test.describe'
      : 'test';
    const aliasDescription =
      match.groups?.spreadOwner === undefined
        ? 'Object.assign alias'
        : 'object-spread alias';

    return collectObjectRestPropertyEntriesForSource(
      relativePath,
      source,
      alias,
      ownerDescription,
      modifiers,
      aliasDescription,
    );
  });

  return [...aliasEntries, ...objectRestEntries, ...copiedObjectEntries];
};

const collectAliasedModifierEntries = (modifiers: readonly string[]) =>
  collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectAliasedModifierEntriesForSource(
      relativePath,
      source,
      modifiers,
    );
  });

const collectAliasedPageMethodEntriesForSource = (
  relativePath: string,
  source: string,
  methods: readonly string[],
) => {
  const allowedMethods = new Set(methods);
  const staticStringAliases = collectStaticStringAliases(source);
  const aliases = new Map<string, string>();

  for (const match of source.matchAll(pageMethodAliasPattern)) {
    const alias = match.groups?.alias;
    const method = modifierForAliasMatch(match);

    if (
      alias !== undefined &&
      method !== undefined &&
      allowedMethods.has(method)
    ) {
      aliases.set(alias, method);
    }
  }

  for (const match of source.matchAll(pageStaticPropertyMethodAliasPattern)) {
    const alias = match.groups?.alias;
    const methodAlias = match.groups?.methodAlias;
    const method =
      methodAlias === undefined
        ? undefined
        : staticStringAliases.get(methodAlias);

    if (
      alias !== undefined &&
      method !== undefined &&
      allowedMethods.has(method)
    ) {
      aliases.set(alias, method);
    }
  }

  for (const match of source.matchAll(pageDestructuredMethodAliasPattern)) {
    const bindings = match.groups?.bindings;

    if (bindings === undefined) {
      continue;
    }

    for (const binding of bindings.split(',')) {
      const bindingMatch = binding
        .trim()
        .match(destructuredPageMethodBindingPattern);
      const method = bindingMatch?.groups?.method;
      const alias = bindingMatch?.groups?.alias ?? method;

      if (
        alias !== undefined &&
        method !== undefined &&
        allowedMethods.has(method)
      ) {
        aliases.set(alias, method);
      }
    }
  }

  const aliasEntries = [...aliases.entries()].flatMap(([alias, method]) => {
    const aliasCallPattern = new RegExp(
      String.raw`\b${escapeRegExp(alias)}\s*\(`,
      'g',
    );

    return collectPatternEntriesForSource(
      relativePath,
      source,
      aliasCallPattern,
    )
      .filter((entry) => !entry.includes(`:${alias} =`))
      .map((entry) => `${entry} (page.${method} alias)`);
  });

  const objectRestEntries = [
    ...source.matchAll(pageObjectRestMethodAliasPattern),
  ].flatMap((match) => {
    const alias = match.groups?.alias;

    return alias === undefined
      ? []
      : collectObjectRestPropertyEntriesForSource(
          relativePath,
          source,
          alias,
          'page',
          methods,
        );
  });

  const copiedObjectEntries = [
    ...source.matchAll(pageCopiedMethodObjectAliasPattern),
  ].flatMap((match) => {
    const alias = match.groups?.alias;

    if (alias === undefined) {
      return [];
    }

    const aliasDescription = match[0].includes('Object.assign')
      ? 'Object.assign alias'
      : 'object-spread alias';

    return collectObjectRestPropertyEntriesForSource(
      relativePath,
      source,
      alias,
      'page',
      methods,
      aliasDescription,
    );
  });

  return [...aliasEntries, ...objectRestEntries, ...copiedObjectEntries];
};

const collectAliasedPageMethodEntries = (methods: readonly string[]) =>
  collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectAliasedPageMethodEntriesForSource(
      relativePath,
      source,
      methods,
    );
  });

const collectPlaywrightSkipEntries = () => [
  ...collectPatternEntries(skipPattern),
  ...collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectStaticPropertyEntriesForSource(
      relativePath,
      source,
      playwrightCallablePattern.source,
      ['skip', 'fixme'],
    );
  }),
  ...collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectReflectPropertyEntriesForSource(
      relativePath,
      source,
      playwrightCallablePattern.source,
      ['skip', 'fixme'],
    );
  }),
  ...collectAliasedModifierEntries(['skip', 'fixme']),
];

const collectPlaywrightRuntimeModifierEntries = () => [
  ...collectPatternEntries(runtimeModifierPattern),
  ...collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectStaticPropertyEntriesForSource(
      relativePath,
      source,
      String.raw`\b(?:test${playwrightDescribeAccessPattern}|test)`,
      ['slow', 'configure'],
    );
  }),
  ...collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectReflectPropertyEntriesForSource(
      relativePath,
      source,
      String.raw`\b(?:test${playwrightDescribeAccessPattern}|test)`,
      ['slow', 'configure'],
    );
  }),
  ...collectAliasedModifierEntries(['slow', 'configure']),
];

const collectFocusedOnlyEntries = () => [
  ...collectPatternEntries(focusedOnlyPattern),
  ...collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectStaticPropertyEntriesForSource(
      relativePath,
      source,
      playwrightCallablePattern.source,
      ['only'],
    );
  }),
  ...collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectReflectPropertyEntriesForSource(
      relativePath,
      source,
      playwrightCallablePattern.source,
      ['only'],
    );
  }),
  ...collectAliasedModifierEntries(['only']),
];

const collectInteractiveDebugEntries = () => [
  ...collectPatternEntries(interactiveDebugPattern),
  ...collectPatternEntries(pageMethodIndirectInvocationPattern('pause')),
  ...collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectStaticPropertyEntriesForSource(
      relativePath,
      source,
      String.raw`\bpage`,
      ['pause'],
    );
  }),
  ...collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectReflectPropertyEntriesForSource(
      relativePath,
      source,
      String.raw`\bpage`,
      ['pause'],
    );
  }),
  ...collectAliasedPageMethodEntries(['pause']),
];

const sourceContextForEntry = (entry: string): string => {
  const [relativePath, lineNumber] = entry.split(':');
  if (relativePath === undefined || lineNumber === undefined) {
    throw new Error(`Invalid skip inventory entry: ${entry}`);
  }

  const source = readFileSync(path.join(repositoryRoot, relativePath), 'utf8');
  const lines = source.split('\n');
  const startLineIndex = Math.max(Number.parseInt(lineNumber, 10) - 8, 0);
  const endLineIndex = Math.min(
    Number.parseInt(lineNumber, 10) + 8,
    lines.length,
  );

  return lines.slice(startLineIndex, endLineIndex).join('\n');
};

const pathForSkipEntry = (entry: string): string => {
  const [relativePath] = entry.split(':');

  if (relativePath === undefined) {
    throw new Error(`Invalid skip inventory entry: ${entry}`);
  }

return relativePath.replace(/^tests\//u, '');
};

const collectPlaceholderMetadataEntries = () =>
  collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const relativePath = path
      .relative(repositoryRoot, filePath)
      .replaceAll('\\', '/');

    if (allowedPlaceholderMetadataFiles.has(relativePath)) {
      return [];
    }

    const source = readFileSync(filePath, 'utf8');
    const lines = source.split('\n');

    return lines.flatMap((line, index) =>
      [...line.matchAll(placeholderMetadataPattern)].map(
        (match) => `${relativePath}:${index + 1}:${match[0]}`,
      ),
    );
  });

const collectFixedWaitEntries = () => [
  ...collectPatternEntries(fixedWaitPattern),
  ...collectPatternEntries(
    pageMethodIndirectInvocationPattern('waitForTimeout'),
  ),
  ...collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectStaticPropertyEntriesForSource(
      relativePath,
      source,
      String.raw`\bpage`,
      ['waitForTimeout'],
    );
  }),
  ...collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectReflectPropertyEntriesForSource(
      relativePath,
      source,
      String.raw`\bpage`,
      ['waitForTimeout'],
    );
  }),
  ...collectAliasedPageMethodEntries(['waitForTimeout']),
];

const collectScreenshotHelperFixedSleepEntries = () =>
  screenshotHelperPaths.flatMap((relativePath) => {
    const source = readFileSync(
      path.join(repositoryRoot, relativePath),
      'utf8',
    );

    return collectPatternEntriesForSource(
      relativePath,
      source,
      screenshotHelperFixedSleepPattern,
    );
  });

describe('Playwright skip inventory', () => {
  it('recognizes direct and describe-level Playwright skip and focus modifiers', () => {
    expect(
      [...`test.skip('x')`.matchAll(skipPattern)].map((match) => match[0]),
    ).toEqual(['test.skip']);
    expect(
      [...`test.describe.skip('x')`.matchAll(skipPattern)].map(
        (match) => match[0],
      ),
    ).toEqual(['test.describe.skip']);
    expect(
      [...`test['skip']('x')`.matchAll(skipPattern)].map((match) => match[0]),
    ).toEqual([`test['skip']`]);
    expect(
      [
        ...`test
          .skip('x')`.matchAll(skipPattern),
      ].map((match) => formatPatternMatch(match[0])),
    ).toEqual(['test .skip']);
    expect(
      [...`test.describe["fixme"]('x')`.matchAll(skipPattern)].map(
        (match) => match[0],
      ),
    ).toEqual([`test.describe["fixme"]`]);
    expect(
      [
        ...`test['describe']
          .fixme('x')`.matchAll(skipPattern),
      ].map((match) => formatPatternMatch(match[0])),
    ).toEqual([`test['describe'] .fixme`]);
    expect(
      [...`test.describe.only('x')`.matchAll(focusedOnlyPattern)].map(
        (match) => match[0],
      ),
    ).toEqual(['test.describe.only']);
    expect(
      [...`test['only']('x')`.matchAll(focusedOnlyPattern)].map(
        (match) => match[0],
      ),
    ).toEqual([`test['only']`]);
    expect(
      [
        ...`test.describe
          ['only']('x')`.matchAll(focusedOnlyPattern),
      ].map((match) => formatPatternMatch(match[0])),
    ).toEqual([`test.describe ['only']`]);
    expect(
      [
        ...`test.describe.configure({ mode: 'serial' })`.matchAll(
          runtimeModifierPattern,
        ),
      ].map((match) => match[0]),
    ).toEqual(['test.describe.configure']);
    expect(
      [
        ...`test.describe['configure']({ mode: 'serial' })`.matchAll(
          runtimeModifierPattern,
        ),
      ].map((match) => match[0]),
    ).toEqual([`test.describe['configure']`]);
    expect(
      [
        ...`test['describe']
          .configure({ mode: 'serial' })`.matchAll(runtimeModifierPattern),
      ].map((match) => formatPatternMatch(match[0])),
    ).toEqual([`test['describe'] .configure`]);
    expect(
      [...`test.slow()`.matchAll(runtimeModifierPattern)].map(
        (match) => match[0],
      ),
    ).toEqual(['test.slow']);
    expect(
      [...`test["slow"]()`.matchAll(runtimeModifierPattern)].map(
        (match) => match[0],
      ),
    ).toEqual([`test["slow"]`]);
    expect(
      [
        ...`test
          ['slow']()`.matchAll(runtimeModifierPattern),
      ].map((match) => formatPatternMatch(match[0])),
    ).toEqual([`test ['slow']`]);
    expect(
      collectPatternEntriesForSource(
        'tests/specs/example/split-modifiers.spec.ts',
        `test
          .skip('hidden skip', () => {});
test.describe
          ['only']('hidden focus', () => {});
test['describe']
          .configure({ mode: 'serial' });`,
        new RegExp(
          String.raw`${skipPattern.source}|${focusedOnlyPattern.source}|${runtimeModifierPattern.source}`,
          'g',
        ),
      ),
    ).toEqual([
      'tests/specs/example/split-modifiers.spec.ts:1:test .skip',
      "tests/specs/example/split-modifiers.spec.ts:3:test.describe ['only']",
      "tests/specs/example/split-modifiers.spec.ts:5:test['describe'] .configure",
    ]);
    expect(
      collectPatternEntriesForSource(
        'tests/specs/example/split-debug.spec.ts',
        `await page
          .pause();
await page['pause']();
await page
          .waitForTimeout(100);
await page
          ['waitForTimeout'](100);
debugger;`,
        new RegExp(
          String.raw`${interactiveDebugPattern.source}|${fixedWaitPattern.source}`,
          'g',
        ),
      ),
    ).toEqual([
      'tests/specs/example/split-debug.spec.ts:1:page .pause(',
      "tests/specs/example/split-debug.spec.ts:3:page['pause'](",
      'tests/specs/example/split-debug.spec.ts:4:.waitForTimeout(',
      "tests/specs/example/split-debug.spec.ts:6:['waitForTimeout'](",
      'tests/specs/example/split-debug.spec.ts:8:debugger',
    ]);
    expect(
      collectPatternEntriesForSource(
        'tests/support/utils/doc-screenshot.ts',
        `await new Promise((resolve) => setTimeout
          (resolve, 100));`,
        screenshotHelperFixedSleepPattern,
      ),
    ).toEqual(['tests/support/utils/doc-screenshot.ts:1:setTimeout (']);
  });

  it('recognizes constant-backed Playwright and page property modifiers', () => {
    const staticPropertySource = `const skipKey = 'skip';
test[skipKey]('hidden skip', () => {});
const focusPart = 'on';
const onlyKey = focusPart + 'ly';
test.describe[onlyKey]('hidden focus', () => {});
const configureKey = 'configure';
test.describe[configureKey]({ mode: 'serial' });
const slowKey = 'slow';
test[slowKey]();
const pauseKey = 'pause';
await page[pauseKey]();
const waitPrefix = 'waitFor';
const waitKey = waitPrefix + 'Timeout';
await page[waitKey](100);
await page[waitKey].call(page, 100);
const arraySkipKey = ['sk', 'ip'].join('');
test[arraySkipKey]('array hidden skip', () => {});
const arrayOnlyKey = ['on'].concat(['ly']).join('');
test.describe[arrayOnlyKey]('array hidden focus', () => {});
const arrayPauseKey = ['pau', 'se'].join('');
await page[arrayPauseKey]();
const arrayWaitKey = ['waitFor'].concat(['Timeout']).join('');
await page[arrayWaitKey](100);
await page[arrayWaitKey].apply(page, [100]);`;

    expect(
      collectStaticPropertyEntriesForSource(
        'tests/specs/example/static-properties.spec.ts',
        staticPropertySource,
        playwrightCallablePattern.source,
        ['skip', 'fixme'],
      ),
    ).toEqual([
      'tests/specs/example/static-properties.spec.ts:2:test[skipKey]( (skip property alias)',
      'tests/specs/example/static-properties.spec.ts:17:test[arraySkipKey]( (skip property alias)',
    ]);
    expect(
      collectStaticPropertyEntriesForSource(
        'tests/specs/example/static-properties.spec.ts',
        staticPropertySource,
        playwrightCallablePattern.source,
        ['only'],
      ),
    ).toEqual([
      'tests/specs/example/static-properties.spec.ts:5:test.describe[onlyKey]( (only property alias)',
      'tests/specs/example/static-properties.spec.ts:19:test.describe[arrayOnlyKey]( (only property alias)',
    ]);
    expect(
      collectStaticPropertyEntriesForSource(
        'tests/specs/example/static-properties.spec.ts',
        staticPropertySource,
        String.raw`\b(?:test${playwrightDescribeAccessPattern}|test)`,
        ['slow', 'configure'],
      ),
    ).toEqual([
      'tests/specs/example/static-properties.spec.ts:7:test.describe[configureKey]( (configure property alias)',
      'tests/specs/example/static-properties.spec.ts:9:test[slowKey]( (slow property alias)',
    ]);
    expect(
      collectStaticPropertyEntriesForSource(
        'tests/specs/example/static-properties.spec.ts',
        staticPropertySource,
        String.raw`\bpage`,
        ['pause'],
      ),
    ).toEqual([
      'tests/specs/example/static-properties.spec.ts:11:page[pauseKey]( (pause property alias)',
      'tests/specs/example/static-properties.spec.ts:21:page[arrayPauseKey]( (pause property alias)',
    ]);
    expect(
      collectStaticPropertyEntriesForSource(
        'tests/specs/example/static-properties.spec.ts',
        staticPropertySource,
        String.raw`\bpage`,
        ['waitForTimeout'],
      ),
    ).toEqual([
      'tests/specs/example/static-properties.spec.ts:14:page[waitKey]( (waitForTimeout property alias)',
      'tests/specs/example/static-properties.spec.ts:15:page[waitKey].call (waitForTimeout property alias)',
      'tests/specs/example/static-properties.spec.ts:23:page[arrayWaitKey]( (waitForTimeout property alias)',
      'tests/specs/example/static-properties.spec.ts:24:page[arrayWaitKey].apply (waitForTimeout property alias)',
    ]);
  });

  it('recognizes aliased Playwright modifiers before inventory checks run', () => {
    const aliasedModifierSource = `const hiddenSkip = test.skip;
hiddenSkip('hidden skip', () => {});
const { fixme: hiddenFixme } = test;
hiddenFixme('hidden fixme', () => {});
const hiddenFocus = test.describe.only;
hiddenFocus('hidden focus', () => {});
const { describe: { skip: nestedDescribeSkip } } = test;
nestedDescribeSkip('nested hidden skip', () => {});
const { describe: { only: nestedDescribeFocus } } = test;
nestedDescribeFocus('nested hidden focus', () => {});
const { describe: { configure: nestedDescribeConfigure } } = test;
nestedDescribeConfigure({ mode: 'serial' });
const { configure: configureSerial } = test.describe;
configureSerial({ mode: 'serial' });
const hiddenSlow = test.slow;
hiddenSlow();
const skipKey = 'skip';
const hiddenStaticSkip = test[skipKey];
hiddenStaticSkip('hidden static skip', () => {});
const onlyKey = 'only';
const hiddenStaticFocus = test.describe[onlyKey];
hiddenStaticFocus('hidden static focus', () => {});
const configureKey = 'configure';
const configureStaticSerial = test.describe[configureKey];
configureStaticSerial({ mode: 'serial' });`;

    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/aliased-modifiers.spec.ts',
        aliasedModifierSource,
        ['skip', 'fixme'],
      ),
    ).toEqual([
      'tests/specs/example/aliased-modifiers.spec.ts:2:hiddenSkip( (skip alias)',
      'tests/specs/example/aliased-modifiers.spec.ts:19:hiddenStaticSkip( (skip alias)',
      'tests/specs/example/aliased-modifiers.spec.ts:4:hiddenFixme( (fixme alias)',
      'tests/specs/example/aliased-modifiers.spec.ts:8:nestedDescribeSkip( (skip alias)',
    ]);
    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/aliased-modifiers.spec.ts',
        aliasedModifierSource,
        ['only'],
      ),
    ).toEqual([
      'tests/specs/example/aliased-modifiers.spec.ts:6:hiddenFocus( (only alias)',
      'tests/specs/example/aliased-modifiers.spec.ts:22:hiddenStaticFocus( (only alias)',
      'tests/specs/example/aliased-modifiers.spec.ts:10:nestedDescribeFocus( (only alias)',
    ]);
    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/aliased-modifiers.spec.ts',
        aliasedModifierSource,
        ['slow', 'configure'],
      ),
    ).toEqual([
      'tests/specs/example/aliased-modifiers.spec.ts:16:hiddenSlow( (slow alias)',
      'tests/specs/example/aliased-modifiers.spec.ts:25:configureStaticSerial( (configure alias)',
      'tests/specs/example/aliased-modifiers.spec.ts:14:configureSerial( (configure alias)',
      'tests/specs/example/aliased-modifiers.spec.ts:12:nestedDescribeConfigure( (configure alias)',
    ]);
  });

  it('recognizes object-rest copied Playwright modifiers before inventory checks run', () => {
    const objectRestModifierSource = `const skipKey = 'skip';
const { skip: ignoredSkip, ...testRest } = test;
testRest.skip('hidden rest skip', () => {});
testRest[skipKey]('hidden static rest skip', () => {});
const { only: ignoredOnly, ...describeRest } = test.describe;
describeRest.only('hidden rest focus', () => {});
const configureKey = 'configure';
describeRest[configureKey]({ mode: 'serial' });
const { slow: ignoredSlow, ...runtimeRest } = test;
runtimeRest.slow();`;

    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/object-rest-modifiers.spec.ts',
        objectRestModifierSource,
        ['skip', 'fixme'],
      ),
    ).toEqual([
      'tests/specs/example/object-rest-modifiers.spec.ts:3:testRest.skip( (test.skip object-rest alias)',
      'tests/specs/example/object-rest-modifiers.spec.ts:4:testRest[skipKey]( (test.skip object-rest alias)',
    ]);
    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/object-rest-modifiers.spec.ts',
        objectRestModifierSource,
        ['only'],
      ),
    ).toEqual([
      'tests/specs/example/object-rest-modifiers.spec.ts:6:describeRest.only( (test.describe.only object-rest alias)',
    ]);
    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/object-rest-modifiers.spec.ts',
        objectRestModifierSource,
        ['slow', 'configure'],
      ),
    ).toEqual([
      'tests/specs/example/object-rest-modifiers.spec.ts:8:describeRest[configureKey]( (test.describe.configure object-rest alias)',
      'tests/specs/example/object-rest-modifiers.spec.ts:10:runtimeRest.slow( (test.slow object-rest alias)',
    ]);
  });

  it('recognizes object-spread and assigned Playwright modifier objects before inventory checks run', () => {
    const copiedModifierSource = `const skipKey = 'skip';
const spreadTest = { ...test };
spreadTest.skip('hidden spread skip', () => {});
spreadTest[skipKey]('hidden static spread skip', () => {});
const assignedDescribe = Object.assign({}, test.describe);
assignedDescribe.only('hidden assigned focus', () => {});
const configureKey = 'configure';
assignedDescribe[configureKey]({ mode: 'serial' });
const spreadRuntime = { ...test };
spreadRuntime.slow();`;

    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/copied-modifier-objects.spec.ts',
        copiedModifierSource,
        ['skip', 'fixme'],
      ),
    ).toEqual([
      'tests/specs/example/copied-modifier-objects.spec.ts:3:spreadTest.skip( (test.skip object-spread alias)',
      'tests/specs/example/copied-modifier-objects.spec.ts:4:spreadTest[skipKey]( (test.skip object-spread alias)',
    ]);
    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/copied-modifier-objects.spec.ts',
        copiedModifierSource,
        ['only'],
      ),
    ).toEqual([
      'tests/specs/example/copied-modifier-objects.spec.ts:6:assignedDescribe.only( (test.describe.only Object.assign alias)',
    ]);
    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/copied-modifier-objects.spec.ts',
        copiedModifierSource,
        ['slow', 'configure'],
      ),
    ).toEqual([
      'tests/specs/example/copied-modifier-objects.spec.ts:8:assignedDescribe[configureKey]( (test.describe.configure Object.assign alias)',
      'tests/specs/example/copied-modifier-objects.spec.ts:10:spreadRuntime.slow( (test.slow object-spread alias)',
    ]);
  });

  it('recognizes aliased page debug and fixed-wait helpers before inventory checks run', () => {
    const aliasedPageMethodSource = `const pauseForDebug = page.pause;
await pauseForDebug();
const { pause: pauseFromPage } = page;
await pauseFromPage();
const waitByAlias = page.waitForTimeout;
await waitByAlias(100);
const { waitForTimeout } = page;
await waitForTimeout(100);
const pauseKey = 'pause';
const pauseByStaticKey = page[pauseKey];
await pauseByStaticKey();
const waitKey = 'waitFor' + 'Timeout';
const waitByStaticKey = page[waitKey];
await waitByStaticKey(100);`;

    expect(
      collectAliasedPageMethodEntriesForSource(
        'tests/specs/example/aliased-page-methods.spec.ts',
        aliasedPageMethodSource,
        ['pause'],
      ),
    ).toEqual([
      'tests/specs/example/aliased-page-methods.spec.ts:2:pauseForDebug( (page.pause alias)',
      'tests/specs/example/aliased-page-methods.spec.ts:11:pauseByStaticKey( (page.pause alias)',
      'tests/specs/example/aliased-page-methods.spec.ts:4:pauseFromPage( (page.pause alias)',
    ]);
    expect(
      collectAliasedPageMethodEntriesForSource(
        'tests/specs/example/aliased-page-methods.spec.ts',
        aliasedPageMethodSource,
        ['waitForTimeout'],
      ),
    ).toEqual([
      'tests/specs/example/aliased-page-methods.spec.ts:6:waitByAlias( (page.waitForTimeout alias)',
      'tests/specs/example/aliased-page-methods.spec.ts:14:waitByStaticKey( (page.waitForTimeout alias)',
      'tests/specs/example/aliased-page-methods.spec.ts:8:waitForTimeout( (page.waitForTimeout alias)',
    ]);
  });

  it('recognizes object-rest copied page debug and fixed-wait helpers before inventory checks run', () => {
    const objectRestPageMethodSource = `const pauseKey = 'pause';
const { pause: ignoredPause, ...pageRest } = page;
await pageRest.pause();
await pageRest[pauseKey]();
const waitKey = 'waitForTimeout';
const { waitForTimeout: ignoredWait, ...timingRest } = page;
await timingRest.waitForTimeout(100);
await timingRest[waitKey].apply(page, [100]);`;

    expect(
      collectAliasedPageMethodEntriesForSource(
        'tests/specs/example/object-rest-page-methods.spec.ts',
        objectRestPageMethodSource,
        ['pause'],
      ),
    ).toEqual([
      'tests/specs/example/object-rest-page-methods.spec.ts:3:pageRest.pause( (page.pause object-rest alias)',
      'tests/specs/example/object-rest-page-methods.spec.ts:4:pageRest[pauseKey]( (page.pause object-rest alias)',
    ]);
    expect(
      collectAliasedPageMethodEntriesForSource(
        'tests/specs/example/object-rest-page-methods.spec.ts',
        objectRestPageMethodSource,
        ['waitForTimeout'],
      ),
    ).toEqual([
      'tests/specs/example/object-rest-page-methods.spec.ts:7:timingRest.waitForTimeout( (page.waitForTimeout object-rest alias)',
      'tests/specs/example/object-rest-page-methods.spec.ts:8:timingRest[waitKey].apply (page.waitForTimeout object-rest alias)',
    ]);
  });

  it('recognizes object-spread and assigned page debug and fixed-wait helpers before inventory checks run', () => {
    const copiedPageMethodSource = `const pauseKey = 'pause';
const spreadPage = { ...page };
await spreadPage.pause();
await spreadPage[pauseKey]();
const waitKey = 'waitForTimeout';
const assignedPage = Object.assign({}, page);
await assignedPage.waitForTimeout(100);
await assignedPage[waitKey].apply(page, [100]);`;

    expect(
      collectAliasedPageMethodEntriesForSource(
        'tests/specs/example/copied-page-methods.spec.ts',
        copiedPageMethodSource,
        ['pause'],
      ),
    ).toEqual([
      'tests/specs/example/copied-page-methods.spec.ts:3:spreadPage.pause( (page.pause object-spread alias)',
      'tests/specs/example/copied-page-methods.spec.ts:4:spreadPage[pauseKey]( (page.pause object-spread alias)',
    ]);
    expect(
      collectAliasedPageMethodEntriesForSource(
        'tests/specs/example/copied-page-methods.spec.ts',
        copiedPageMethodSource,
        ['waitForTimeout'],
      ),
    ).toEqual([
      'tests/specs/example/copied-page-methods.spec.ts:7:assignedPage.waitForTimeout( (page.waitForTimeout Object.assign alias)',
      'tests/specs/example/copied-page-methods.spec.ts:8:assignedPage[waitKey].apply (page.waitForTimeout Object.assign alias)',
    ]);
  });

  it('recognizes indirect page debug and fixed-wait helper invocations before inventory checks run', () => {
    const indirectPageMethodSource = `await page.pause.bind(page)();
await page['pause']['call'](page);
await page.waitForTimeout.bind(page)(100);
await page['waitForTimeout'].apply(page, [100]);`;

    expect(
      collectPatternEntriesForSource(
        'tests/specs/example/indirect-page-methods.spec.ts',
        indirectPageMethodSource,
        pageMethodIndirectInvocationPattern('pause'),
      ),
    ).toEqual([
      'tests/specs/example/indirect-page-methods.spec.ts:1:page.pause.bind',
      "tests/specs/example/indirect-page-methods.spec.ts:2:page['pause']['call']",
    ]);
    expect(
      collectPatternEntriesForSource(
        'tests/specs/example/indirect-page-methods.spec.ts',
        indirectPageMethodSource,
        pageMethodIndirectInvocationPattern('waitForTimeout'),
      ),
    ).toEqual([
      'tests/specs/example/indirect-page-methods.spec.ts:3:page.waitForTimeout.bind',
      "tests/specs/example/indirect-page-methods.spec.ts:4:page['waitForTimeout'].apply",
    ]);
  });

  it('recognizes reflected Playwright modifiers and page wait helpers', () => {
    const reflectedModifierSource = `const skipKey = 'skip';
Reflect.get(test, skipKey)('hidden skip', () => {});
const reflectedFixme = Reflect.get(test.describe, 'fixme');
reflectedFixme('hidden fixme', () => {});
const reflectMirror = Reflect;
reflectMirror.get(test.describe, 'only')('hidden focus', () => {});
const configureKey = 'configure';
reflectMirror.get(test.describe, configureKey)({ mode: 'serial' });
const reflectedSlow = reflectMirror.get(test, 'slow');
reflectedSlow();
Reflect.apply(test.skip, test, ['hidden apply skip', () => {}]);
reflectMirror.apply(Reflect.get(test.describe, 'only'), test.describe, ['hidden apply focus', () => {}]);
const pauseKey = 'pause';
reflectMirror.get(page, pauseKey)();
Reflect.apply(page.pause, page, []);
const waitKey = 'waitFor' + 'Timeout';
const reflectedWait = Reflect.get(page, waitKey);
await reflectedWait(100);
reflectMirror.apply(Reflect.get(page, waitKey), page, [100]);`;

    expect(
      collectReflectPropertyEntriesForSource(
        'tests/specs/example/reflected-modifiers.spec.ts',
        reflectedModifierSource,
        playwrightCallablePattern.source,
        ['skip', 'fixme'],
      ),
    ).toEqual([
      'tests/specs/example/reflected-modifiers.spec.ts:2:Reflect.get(test, skipKey)( (skip Reflect.get)',
      'tests/specs/example/reflected-modifiers.spec.ts:11:Reflect.apply(test.skip (Reflect.apply)',
      'tests/specs/example/reflected-modifiers.spec.ts:4:reflectedFixme( (fixme Reflect.get alias)',
    ]);
    expect(
      collectReflectPropertyEntriesForSource(
        'tests/specs/example/reflected-modifiers.spec.ts',
        reflectedModifierSource,
        playwrightCallablePattern.source,
        ['only'],
      ),
    ).toEqual([
      "tests/specs/example/reflected-modifiers.spec.ts:6:reflectMirror.get(test.describe, 'only')( (only Reflect.get)",
      "tests/specs/example/reflected-modifiers.spec.ts:12:reflectMirror.apply(Reflect.get(test.describe, 'only') (only Reflect.apply get)",
    ]);
    expect(
      collectReflectPropertyEntriesForSource(
        'tests/specs/example/reflected-modifiers.spec.ts',
        reflectedModifierSource,
        String.raw`\b(?:test${playwrightDescribeAccessPattern}|test)`,
        ['slow', 'configure'],
      ),
    ).toEqual([
      'tests/specs/example/reflected-modifiers.spec.ts:8:reflectMirror.get(test.describe, configureKey)( (configure Reflect.get)',
      'tests/specs/example/reflected-modifiers.spec.ts:10:reflectedSlow( (slow Reflect.get alias)',
    ]);
    expect(
      collectReflectPropertyEntriesForSource(
        'tests/specs/example/reflected-modifiers.spec.ts',
        reflectedModifierSource,
        String.raw`\bpage`,
        ['pause'],
      ),
    ).toEqual([
      'tests/specs/example/reflected-modifiers.spec.ts:14:reflectMirror.get(page, pauseKey)( (pause Reflect.get)',
      'tests/specs/example/reflected-modifiers.spec.ts:15:Reflect.apply(page.pause (Reflect.apply)',
    ]);
    expect(
      collectReflectPropertyEntriesForSource(
        'tests/specs/example/reflected-modifiers.spec.ts',
        reflectedModifierSource,
        String.raw`\bpage`,
        ['waitForTimeout'],
      ),
    ).toEqual([
      'tests/specs/example/reflected-modifiers.spec.ts:19:reflectMirror.apply(Reflect.get(page, waitKey) (waitForTimeout Reflect.apply get)',
      'tests/specs/example/reflected-modifiers.spec.ts:18:reflectedWait( (waitForTimeout Reflect.get alias)',
    ]);
  });

  it('keeps the active test inventory aligned with Playwright docs and specs on disk', () => {
    expect(collectActiveInventoryFiles().toSorted()).toEqual(
      collectPlaywrightSpecAndDocumentFiles().toSorted(),
    );
  });

  it('keeps every skip and fixme explicitly classified', () => {
    const entries = collectPlaywrightSkipEntries().toSorted();

    expect(entries).toEqual([...allowedEntries].toSorted());
  });

  it('keeps every allowed skip and fixme tied to a reason', () => {
    expect(
      allowedPlaywrightSkipEntries.map((entry) => entry.reason.trim()),
    ).toEqual([
      'Auth0 Management credentials are required for the integration doc.',
      'Auth0 Management credentials are required for create-account integration coverage.',
      'A Stripe webhook signing secret is required for replay coverage.',
    ]);
  });

  it('keeps every allowed runtime modifier tied to a reason', () => {
    expect(
      allowedPlaywrightRuntimeModifierEntries.map((entry) =>
        entry.reason.trim(),
      ),
    ).toEqual([
      'The registration documentation flow runs serially with one retry because it mutates shared event registration state while proving the full free/paid journey.',
      'The free registration documentation flow performs Auth0 login, event navigation, database readbacks, and generated-doc attachments.',
      'The paid registration documentation flow performs Stripe checkout replay, webhook delivery, database readbacks, and generated-doc attachments.',
    ]);
  });

  it('keeps every allowed runtime modifier documented in the inventory', () => {
    const inventory = readFileSync(testInventoryPath, 'utf8');

    for (const entry of allowedPlaywrightRuntimeModifierEntries) {
      expect(inventory).toContain(pathForSkipEntry(entry.entry));
    }

    expect(inventory).toContain(
      'current runtime-modifier allowlist is limited to',
    );
    expect(inventory).toContain(
      '`docs/events/register.doc.ts`: the registration documentation flow',
    );
    expect(inventory).toContain('mutates shared registration state');
    expect(inventory).toContain(
      'free and paid\n  registration documentation cases are marked slow',
    );
    expect(inventory).toContain('Auth0 login');
    expect(inventory).toContain('Stripe/webhook work');
    expect(inventory).toContain('generated-doc attachments');
  });

  it('keeps every allowed skip tied to the credential variables that justify it', () => {
    for (const entry of allowedPlaywrightSkipEntries) {
      const sourceContext = sourceContextForEntry(entry.entry);

      for (const environmentVariable of entry.requiredEnvironment) {
        expect(sourceContext).toContain(environmentVariable);
      }
    }
  });

  it('keeps every allowed skip documented with its credential variables in the inventory', () => {
    const inventory = readFileSync(testInventoryPath, 'utf8');

    for (const entry of allowedPlaywrightSkipEntries) {
      expect(inventory).toContain(pathForSkipEntry(entry.entry));

      for (const environmentVariable of entry.requiredEnvironment) {
        expect(inventory).toContain(environmentVariable);
      }
    }
  });

  it('keeps real Playwright titles free of placeholder metadata', () => {
    expect(collectPlaceholderMetadataEntries()).toEqual([]);
  });

  it('keeps Playwright specs and docs free of fixed timeout waits', () => {
    expect(collectFixedWaitEntries()).toEqual([]);
  });

  it('keeps documentation screenshot settling free of fixed sleep polling', () => {
    expect(collectScreenshotHelperFixedSleepEntries()).toEqual([]);
  });
});
