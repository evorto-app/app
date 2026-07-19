import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { assertLegacyHistoryMigrationSupported } from '../../migration/preflight';

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));

const noUnsupportedHistory = {
  collectedFees: 0,
  costItems: 0,
  eventSubmissionItems: 0,
  lineItems: 0,
  receipts: 0,
  registrations: 0,
  transactions: 0,
} as const;

describe('legacy history migration preflight', () => {
  it('allows a tenant with no unsupported history', () => {
    expect(() =>
      assertLegacyHistoryMigrationSupported('tumi', {
        ...noUnsupportedHistory,
      }),
    ).not.toThrow();
  });

  it.each([
    [
      {
        ...noUnsupportedHistory,
        registrations: 1,
      },
      '1 registrations',
    ],
    [
      {
        ...noUnsupportedHistory,
        transactions: 2,
      },
      '2 transactions',
    ],
    [
      {
        ...noUnsupportedHistory,
        lineItems: 3,
      },
      '3 product line items',
    ],
    [
      {
        ...noUnsupportedHistory,
        collectedFees: 2,
      },
      '2 collected fees',
    ],
    [
      {
        ...noUnsupportedHistory,
        costItems: 6,
      },
      '6 cost items',
    ],
    [
      {
        ...noUnsupportedHistory,
        receipts: 7,
      },
      '7 receipts',
    ],
    [
      {
        ...noUnsupportedHistory,
        eventSubmissionItems: 8,
      },
      '8 event submission items',
    ],
    [
      {
        ...noUnsupportedHistory,
        collectedFees: 2,
        costItems: 6,
        eventSubmissionItems: 8,
        lineItems: 3,
        receipts: 7,
        registrations: 4,
        transactions: 5,
      },
      '4 registrations',
    ],
  ])('blocks unsupported legacy history %o', (counts, expected) => {
    expect(() => assertLegacyHistoryMigrationSupported('tumi', counts)).toThrow(
      expected,
    );
    expect(() => assertLegacyHistoryMigrationSupported('tumi', counts)).toThrow(
      'Production cutover is blocked',
    );
  });

  it('queries every unsupported tenant-owned history table', () => {
    const preflight = readFileSync(
      path.join(repositoryRoot, 'migration/preflight.ts'),
      'utf8',
    );

    expect(preflight).toContain('.from(oldSchema.costItem)');
    expect(preflight).toContain('.from(oldSchema.receipt)');
    expect(preflight).toContain('.from(oldSchema.eventSubmissionItem)');
    expect(preflight).toContain(
      'eq(oldSchema.eventSubmissionItem.productId, oldSchema.product.id)',
    );
    expect(preflight).toContain(
      'eq(oldSchema.eventTemplate.tenantId, tenant.id)',
    );
  });
});
