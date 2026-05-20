import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;
const testsRoot = join(repositoryRoot, 'tests');

const allowedEntries = new Set([
  'tests/docs/users/create-account.doc.ts:20:test.skip',
  'tests/specs/events/price-labels-inclusive.spec.ts:4:test.fixme',
  'tests/specs/events/price-labels-inclusive.spec.ts:6:test.fixme',
  'tests/specs/events/price-labels-inclusive.spec.ts:8:test.fixme',
  'tests/specs/events/price-labels-inclusive.spec.ts:10:test.fixme',
  'tests/specs/events/price-labels-inclusive.spec.ts:12:test.fixme',
  'tests/specs/events/price-labels-inclusive.spec.ts:14:test.fixme',
  'tests/specs/events/price-labels-inclusive.spec.ts:16:test.fixme',
  'tests/specs/finance/stripe-webhook-replay.spec.ts:16:test.skip',
  'tests/specs/templates/paid-option-requires-tax-rate.spec.ts:72:test.fixme',
  'tests/specs/templates/paid-option-requires-tax-rate.spec.ts:74:test.fixme',
]);

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
});
