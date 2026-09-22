import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { PlatformOperationReason } from './platform-operations.shared';

describe('platform operation reason', () => {
  it('trims a reason before it crosses the mutation boundary', () => {
    expect(
      Schema.decodeUnknownSync(PlatformOperationReason)(
        '  Requested by the organization  ',
      ),
    ).toBe('Requested by the organization');
  });
  it('rejects empty or overlong reasons after trimming', () => {
    for (const reason of ['', ' '.repeat(3), 'x'.repeat(501)]) {
      expect(() =>
        Schema.decodeUnknownSync(PlatformOperationReason)(reason),
      ).toThrow();
    }
  });
});
