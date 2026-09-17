import { describe, expect, it } from '@effect/vitest';

import { normalizeEsnCardConfig } from './discount-provider-config';

describe('normalizeEsnCardConfig', () => {
  it('normalizes the one supported secure purchase link', () => {
    expect(normalizeEsnCardConfig(' https://cards.example.test/buy ')).toEqual({
      buyEsnCardUrl: 'https://cards.example.test/buy',
    });
    expect(normalizeEsnCardConfig(null)).toEqual({});
    expect(normalizeEsnCardConfig(undefined)).toEqual({});
    expect(normalizeEsnCardConfig(' '.repeat(3))).toEqual({});
  });

  it('rejects invalid links instead of dropping them', () => {
    for (const value of [
      'not-a-link',
      'http://cards.example.test/buy',
      'javascript:alert(1)',
    ]) {
      expect(() => normalizeEsnCardConfig(value)).toThrow(
        'buyEsnCardUrl must be a valid HTTPS URL',
      );
    }
  });
});
