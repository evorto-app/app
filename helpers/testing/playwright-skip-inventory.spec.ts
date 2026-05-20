import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

// Source guard: every skipped browser/doc test needs an explicit reason here so
// uncovered behavior does not disappear behind permanent `test.skip` calls.
const repositoryRoot = new URL('../..', import.meta.url).pathname;
const testsRoot = join(repositoryRoot, 'tests');

const allowedPlaywrightSkipEntries = [
  {
    entry: 'tests/docs/users/create-account.doc.ts:97:test.skip',
    reason:
      'Auth0 Management credentials are required for the integration doc.',
  },
  {
    entry: 'tests/specs/profile/create-account.spec.ts:24:test.skip',
    reason:
      'Auth0 Management credentials are required for create-account integration coverage.',
  },
  {
    entry: 'tests/specs/finance/stripe-webhook-replay.spec.ts:16:test.skip',
    reason: 'A Stripe webhook signing secret is required for replay coverage.',
  },
] as const;

const allowedEntries = new Set(
  allowedPlaywrightSkipEntries.map((entry) => entry.entry),
);

const skipPattern = /\b(?:test|it|describe)\.(skip|fixme)\b/g;
const placeholderMetadataPattern = /@(track|req|doc)\(/g;
const fixedWaitPattern = /\.waitForTimeout\s*\(/g;

const allowedPlaceholderMetadataFiles = new Set([
  'tests/specs/reporting/reporter-paths.test.ts',
]);

const collectTypeScriptFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectTypeScriptFiles(path);
    }

    return entry.isFile() && path.endsWith('.ts') ? [path] : [];
  });

const collectPlaywrightSkipEntries = () =>
  collectTypeScriptFiles(testsRoot).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    const lines = source.split('\n');
    const relativePath = relative(repositoryRoot, path);

    return lines.flatMap((line, index) =>
      [...line.matchAll(skipPattern)].map((match) =>
        `${relativePath}:${index + 1}:${match[0]}`.replaceAll('\\', '/'),
      ),
    );
  });

const collectPlaceholderMetadataEntries = () =>
  collectTypeScriptFiles(testsRoot).flatMap((path) => {
    const relativePath = relative(repositoryRoot, path).replaceAll('\\', '/');

    if (allowedPlaceholderMetadataFiles.has(relativePath)) {
      return [];
    }

    const source = readFileSync(path, 'utf8');
    const lines = source.split('\n');

    return lines.flatMap((line, index) =>
      [...line.matchAll(placeholderMetadataPattern)].map(
        (match) => `${relativePath}:${index + 1}:${match[0]}`,
      ),
    );
  });

const collectFixedWaitEntries = () =>
  collectTypeScriptFiles(testsRoot).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    const lines = source.split('\n');
    const relativePath = relative(repositoryRoot, path).replaceAll('\\', '/');

    return lines.flatMap((line, index) =>
      [...line.matchAll(fixedWaitPattern)].map(
        (match) => `${relativePath}:${index + 1}:${match[0]}`,
      ),
    );
  });

describe('Playwright skip inventory', () => {
  it('keeps every skip and fixme explicitly classified', () => {
    const entries = collectPlaywrightSkipEntries().sort();

    expect(entries).toEqual([...allowedEntries].sort());
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
});
