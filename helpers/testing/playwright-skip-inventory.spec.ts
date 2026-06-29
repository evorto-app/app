import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const repositoryRoot = new URL('../..', import.meta.url).pathname;
const testsRoot = join(repositoryRoot, 'tests');

const allowedPlaywrightSkipEntries = [
  {
    entry: 'tests/docs/events/register.doc.ts:11:test.skip',
    reason:
      'Stripe-backed registration docs are gated while E2E is stabilized.',
  },
  {
    entry: 'tests/docs/finance/receipt-review-reimbursement.doc.ts:7:test.skip',
    reason: 'Finance receipt docs are gated while E2E is stabilized.',
  },
  {
    entry: 'tests/docs/profile/discounts.doc.ts:7:test.skip',
    reason: 'Discount docs are gated while E2E is stabilized.',
  },
  {
    entry: 'tests/docs/roles/roles.doc.ts:7:test.skip',
    reason: 'Role docs are gated while E2E is stabilized.',
  },
  {
    entry: 'tests/docs/templates/templates.doc.ts:7:test.skip',
    reason: 'Template docs are gated while E2E is stabilized.',
  },
  {
    entry: 'tests/docs/users/create-account.doc.ts:20:test.skip',
    reason:
      'Auth0 Management credentials are required for the integration doc.',
  },
  {
    entry: 'tests/specs/events/events.test.ts:8:test.skip',
    reason: 'Event creation coverage is gated while E2E is stabilized.',
  },
  {
    entry: 'tests/specs/events/unlisted-visibility.test.ts:22:test.skip',
    reason: 'Unlisted event coverage is gated while E2E is stabilized.',
  },
  {
    entry: 'tests/specs/events/unlisted-visibility.test.ts:42:test.skip',
    reason: 'Unlisted event coverage is gated while E2E is stabilized.',
  },
  {
    entry: 'tests/specs/events/unlisted-visibility.test.ts:62:test.skip',
    reason: 'Unlisted event coverage is gated while E2E is stabilized.',
  },
  {
    entry: 'tests/specs/finance/receipts-flows.spec.ts:92:test.skip',
    reason: 'Finance receipt flow coverage is gated while E2E is stabilized.',
  },
  {
    entry: 'tests/specs/finance/receipts-flows.spec.ts:130:test.skip',
    reason: 'Finance receipt flow coverage is gated while E2E is stabilized.',
  },
  {
    entry: 'tests/specs/finance/receipts-flows.spec.ts:186:test.skip',
    reason: 'Finance receipt flow coverage is gated while E2E is stabilized.',
  },
  {
    entry: 'tests/specs/finance/stripe-webhook-replay.spec.ts:16:test.skip',
    reason: 'A Stripe webhook signing secret is required for replay coverage.',
  },
  {
    entry:
      'tests/specs/finance/tax-rates/admin-import-tax-rates.spec.ts:8:test.skip',
    reason: 'Tax-rate import E2E is gated while E2E is stabilized.',
  },
  {
    entry: 'tests/specs/permissions/matrix.spec.ts:8:describe.skip',
    reason: 'Permission matrix E2E is gated while E2E is stabilized.',
  },
  {
    entry: 'tests/specs/scanning/scanner.test.ts:12:test.skip',
    reason: 'Scanner E2E is gated while E2E is stabilized.',
  },
  {
    entry:
      'tests/specs/templates/paid-option-requires-tax-rate.spec.ts:114:test.fixme',
    reason: 'Bulk template operations do not have a current UI surface.',
  },
  {
    entry:
      'tests/specs/templates/paid-option-requires-tax-rate.spec.ts:116:test.fixme',
    reason:
      'No-compatible-tax-rate template behavior needs a page-backed UI path.',
  },
] as const;

const allowedEntries = new Set(
  allowedPlaywrightSkipEntries.map((entry) => entry.entry),
);

const skipPattern = /\b(?:test|it|describe)\.(skip|fixme)\b/g;
const placeholderMetadataPattern = /@(track|req|doc)\(/g;

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

describe('Playwright skip inventory', () => {
  it('keeps every skip and fixme explicitly classified', () => {
    const entries = collectPlaywrightSkipEntries().sort();

    expect(entries).toEqual([...allowedEntries].sort());
  });

  it('keeps every allowed skip and fixme tied to a reason', () => {
    expect(
      allowedPlaywrightSkipEntries.every((entry) => entry.reason.trim()),
    ).toBe(true);
  });

  it('keeps real Playwright titles free of placeholder metadata', () => {
    expect(collectPlaceholderMetadataEntries()).toEqual([]);
  });
});
