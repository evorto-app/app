import { Schema } from 'effect';
import { describe, expect, it } from 'vitest';

import { TenantHomePageUrl } from './tenant-home-page';

describe('organization home page links', () => {
  it('accepts absolute web addresses and rejects executable, credential-bearing, and relative links', () => {
    const valid = Schema.is(TenantHomePageUrl);
    expect(valid('https://section.example.org/about?language=en#team')).toBe(
      true,
    );
    expect(valid('http://localhost:4201/')).toBe(true);
    for (const address of [
      'javascript:alert(1)',
      'data:text/html,hello',
      'mailto:team@example.org',
      '/events',
      '//example.org',
      'https://user:password@example.org',
      ' https://example.org',
      'https://',
    ]) {
      expect(valid(address)).toBe(false);
    }
  });
});
