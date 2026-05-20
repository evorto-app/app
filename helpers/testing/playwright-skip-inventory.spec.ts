import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;
const testsRoot = join(repositoryRoot, 'tests');

const allowedPlaywrightSkipEntries = [
  {
    entry: 'tests/docs/users/create-account.doc.ts:20:test.skip',
    reason:
      'Auth0 Management credentials are required for the integration doc.',
  },
  {
    entry: 'tests/specs/finance/stripe-webhook-replay.spec.ts:16:test.skip',
    reason: 'A Stripe webhook signing secret is required for replay coverage.',
  },
  {
    entry:
      'tests/specs/templates/paid-option-requires-tax-rate.spec.ts:72:test.fixme',
    reason: 'Bulk template operations do not have a current UI surface.',
  },
  {
    entry:
      'tests/specs/templates/paid-option-requires-tax-rate.spec.ts:74:test.fixme',
    reason:
      'No-compatible-tax-rate template behavior needs a page-backed UI path.',
  },
] as const;

const allowedEntries = new Set(
  allowedPlaywrightSkipEntries.map((entry) => entry.entry),
);

const skipPattern = /\b(?:test|it|describe)\.(skip|fixme)\b/g;

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
      'A Stripe webhook signing secret is required for replay coverage.',
      'Bulk template operations do not have a current UI surface.',
      'No-compatible-tax-rate template behavior needs a page-backed UI path.',
    ]);
  });
});
