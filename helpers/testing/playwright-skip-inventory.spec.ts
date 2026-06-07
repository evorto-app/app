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
const playwrightModifierAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s+(?<alias>${identifierPattern})\s*=\s*test(?:${playwrightDescribeAccessPattern})?${playwrightModifierAccessCapturePattern('skip|fixme|only|slow|configure')}`,
  'g',
);
const pageMethodAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s+(?<alias>${identifierPattern})\s*=\s*page${playwrightModifierAccessCapturePattern('pause|waitForTimeout')}`,
  'g',
);
const playwrightDestructuredModifierAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s*\{(?<bindings>[^}]+)\}\s*=\s*test(?:${playwrightDescribeAccessPattern})?`,
  'g',
);
const pageDestructuredMethodAliasPattern = new RegExp(
  String.raw`\b(?:const|let|var)\s*\{(?<bindings>[^}]+)\}\s*=\s*page\b`,
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

const collectPatternEntries = (pattern: RegExp) =>
  collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const relativePath = path.relative(repositoryRoot, filePath);

    return collectPatternEntriesForSource(relativePath, source, pattern);
  });

const modifierForAliasMatch = (match: RegExpExecArray): string | undefined =>
  match.groups?.dotModifier ?? match.groups?.bracketModifier;

const collectAliasedModifierEntriesForSource = (
  relativePath: string,
  source: string,
  modifiers: readonly string[],
) => {
  const allowedModifiers = new Set(modifiers);
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

  return [...aliases.entries()].flatMap(([alias, modifier]) => {
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

  return [...aliases.entries()].flatMap(([alias, method]) => {
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
  ...collectAliasedModifierEntries(['skip', 'fixme']),
];

const collectPlaywrightRuntimeModifierEntries = () => [
  ...collectPatternEntries(runtimeModifierPattern),
  ...collectAliasedModifierEntries(['slow', 'configure']),
];

const collectFocusedOnlyEntries = () => [
  ...collectPatternEntries(focusedOnlyPattern),
  ...collectAliasedModifierEntries(['only']),
];

const collectInteractiveDebugEntries = () => [
  ...collectPatternEntries(interactiveDebugPattern),
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

  it('recognizes aliased Playwright modifiers before inventory checks run', () => {
    const aliasedModifierSource = `const hiddenSkip = test.skip;
hiddenSkip('hidden skip', () => {});
const { fixme: hiddenFixme } = test;
hiddenFixme('hidden fixme', () => {});
const hiddenFocus = test.describe.only;
hiddenFocus('hidden focus', () => {});
const { configure: configureSerial } = test.describe;
configureSerial({ mode: 'serial' });
const hiddenSlow = test.slow;
hiddenSlow();`;

    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/aliased-modifiers.spec.ts',
        aliasedModifierSource,
        ['skip', 'fixme'],
      ),
    ).toEqual([
      'tests/specs/example/aliased-modifiers.spec.ts:2:hiddenSkip( (skip alias)',
      'tests/specs/example/aliased-modifiers.spec.ts:4:hiddenFixme( (fixme alias)',
    ]);
    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/aliased-modifiers.spec.ts',
        aliasedModifierSource,
        ['only'],
      ),
    ).toEqual([
      'tests/specs/example/aliased-modifiers.spec.ts:6:hiddenFocus( (only alias)',
    ]);
    expect(
      collectAliasedModifierEntriesForSource(
        'tests/specs/example/aliased-modifiers.spec.ts',
        aliasedModifierSource,
        ['slow', 'configure'],
      ),
    ).toEqual([
      'tests/specs/example/aliased-modifiers.spec.ts:10:hiddenSlow( (slow alias)',
      'tests/specs/example/aliased-modifiers.spec.ts:8:configureSerial( (configure alias)',
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
await waitForTimeout(100);`;

    expect(
      collectAliasedPageMethodEntriesForSource(
        'tests/specs/example/aliased-page-methods.spec.ts',
        aliasedPageMethodSource,
        ['pause'],
      ),
    ).toEqual([
      'tests/specs/example/aliased-page-methods.spec.ts:2:pauseForDebug( (page.pause alias)',
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
      'tests/specs/example/aliased-page-methods.spec.ts:8:waitForTimeout( (page.waitForTimeout alias)',
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
