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
    entry: 'tests/docs/events/register.doc.ts:191:test.slow',
    reason:
      'The free registration documentation flow performs Auth0 login, event navigation, database readbacks, and generated-doc attachments.',
  },
  {
    entry: 'tests/docs/events/register.doc.ts:1002:test.slow',
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
const interactiveDebugPattern = /\bdebugger\b|\bpage\.pause\s*\(/g;
const placeholderMetadataPattern = /@(track|req|doc)\(/g;
const fixedWaitPattern = /\.waitForTimeout\s*\(/g;
const screenshotHelperFixedSleepPattern = /setTimeout\s*\(/g;
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

const collectPlaywrightSkipEntries = () => collectPatternEntries(skipPattern);

const collectPlaywrightRuntimeModifierEntries = () =>
  collectPatternEntries(runtimeModifierPattern);

const collectFocusedOnlyEntries = () =>
  collectPatternEntries(focusedOnlyPattern);

const collectInteractiveDebugEntries = () =>
  collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const lines = source.split('\n');
    const relativePath = path
      .relative(repositoryRoot, filePath)
      .replaceAll('\\', '/');

    return lines.flatMap((line, index) =>
      [...line.matchAll(interactiveDebugPattern)].map(
        (match) => `${relativePath}:${index + 1}:${match[0]}`,
      ),
    );
  });

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

const collectFixedWaitEntries = () =>
  collectTypeScriptFiles(testsRoot).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8');
    const lines = source.split('\n');
    const relativePath = path
      .relative(repositoryRoot, filePath)
      .replaceAll('\\', '/');

    return lines.flatMap((line, index) =>
      [...line.matchAll(fixedWaitPattern)].map(
        (match) => `${relativePath}:${index + 1}:${match[0]}`,
      ),
    );
  });

const collectScreenshotHelperFixedSleepEntries = () =>
  screenshotHelperPaths.flatMap((relativePath) => {
    const source = readFileSync(
      path.join(repositoryRoot, relativePath),
      'utf8',
    );
    const lines = source.split('\n');

    return lines.flatMap((line, index) =>
      [...line.matchAll(screenshotHelperFixedSleepPattern)].map(
        (match) => `${relativePath}:${index + 1}:${match[0]}`,
      ),
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
