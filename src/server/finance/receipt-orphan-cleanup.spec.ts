import { describe, expect, it } from '@effect/vitest';

import { normalizeReceiptOrphanBatchSize } from './receipt-orphan-cleanup';

describe('receipt orphan cleanup', () => {
  it('bounds every cleanup invocation', () => {
    expect(normalizeReceiptOrphanBatchSize(0)).toBe(1);
    expect(normalizeReceiptOrphanBatchSize(50)).toBe(50);
    expect(normalizeReceiptOrphanBatchSize(10_000)).toBe(100);
  });
});
