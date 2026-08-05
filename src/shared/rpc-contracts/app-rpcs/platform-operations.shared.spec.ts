import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { PlatformOperationReason } from './platform-operations.shared';

describe('PlatformOperationReason', () => {
  it('trims a meaningful reason', () => {
    expect(
      Schema.decodeUnknownSync(PlatformOperationReason)(
        '  Approved by the organization board  ',
      ),
    ).toBe('Approved by the organization board');
  });

  it.each([
    '',
    ' '.repeat(3),
    'Attach acct_123456789 for paid sign-ups',
    'Verified (acct_ABC123) with the treasurer',
  ])('rejects an unsafe reason: %j', (reason) => {
    expect(() =>
      Schema.decodeUnknownSync(PlatformOperationReason)(reason),
    ).toThrow();
  });
});
