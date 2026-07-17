import { describe, expect, it } from '@effect/vitest';

import {
  isReceiptUploadOrphan,
  normalizeReceiptOrphanBatchSize,
} from './receipt-orphan-cleanup';

const now = new Date('2026-07-16T12:00:00.000Z');

describe('receipt orphan cleanup', () => {
  it('waits through the safety grace before cleaning pending or rejected files', () => {
    expect(
      isReceiptUploadOrphan({
        expiresAt: new Date('2026-07-16T11:50:01.000Z'),
        now,
        status: 'pending',
        updatedAt: now,
      }),
    ).toBe(false);
    expect(
      isReceiptUploadOrphan({
        expiresAt: new Date('2026-07-16T11:44:59.000Z'),
        now,
        status: 'rejected',
        updatedAt: now,
      }),
    ).toBe(true);
  });

  it('retains ready uploads for a day and never cleans consumed evidence', () => {
    expect(
      isReceiptUploadOrphan({
        expiresAt: new Date('2026-07-15T00:00:00.000Z'),
        now,
        status: 'ready',
        updatedAt: new Date('2026-07-15T12:00:01.000Z'),
      }),
    ).toBe(false);
    expect(
      isReceiptUploadOrphan({
        expiresAt: new Date('2026-07-15T00:00:00.000Z'),
        now,
        status: 'ready',
        updatedAt: new Date('2026-07-15T11:59:59.000Z'),
      }),
    ).toBe(true);
    expect(
      isReceiptUploadOrphan({
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
        now,
        status: 'consumed',
        updatedAt: new Date('2020-01-01T00:00:00.000Z'),
      }),
    ).toBe(false);
  });

  it('bounds every cleanup invocation', () => {
    expect(normalizeReceiptOrphanBatchSize(0)).toBe(1);
    expect(normalizeReceiptOrphanBatchSize(50)).toBe(50);
    expect(normalizeReceiptOrphanBatchSize(10_000)).toBe(100);
  });
});
