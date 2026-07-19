import { describe, expect, it } from 'vitest';

import { requireVerifiedIconSourceColor } from '../../migration/steps/icons';

describe('migration icon verification', () => {
  it('accepts only a successfully verified source color', () => {
    expect(
      requireVerifiedIconSourceColor('calendar', {
        _tag: 'success',
        sourceColor: 123,
      }),
    ).toBe(123);
  });

  it('blocks a busy source instead of importing an unverified icon', () => {
    expect(() =>
      requireVerifiedIconSourceColor('calendar', { _tag: 'busy' }),
    ).toThrow('Icon source is busy');
  });

  it('blocks an unavailable source instead of importing an unverified icon', () => {
    expect(() =>
      requireVerifiedIconSourceColor('calendar', {
        _tag: 'unavailable',
        reason: 'upstream',
      }),
    ).toThrow('could not be verified (upstream)');
  });
});
