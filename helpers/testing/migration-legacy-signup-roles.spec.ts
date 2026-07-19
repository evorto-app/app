import { describe, expect, it } from 'vitest';

import { legacySignupRoleIds } from '../../migration/legacy-signup-roles';

describe('legacy signup role mapping', () => {
  const roleMap = new Map([
    ['NONE', 'regular-role'],
    ['FULL', 'member-role'],
  ]);

  it('maps and deduplicates every configured legacy status', () => {
    expect(
      legacySignupRoleIds(
        ['NONE', 'FULL', 'NONE'],
        roleMap,
        'Legacy event event-1',
      ),
    ).toEqual(['regular-role', 'member-role']);
  });

  it('preserves an empty allow-list as nobody eligible', () => {
    expect(legacySignupRoleIds([], roleMap, 'Legacy event event-1')).toEqual(
      [],
    );
  });

  it('blocks a corrupt null allow-list instead of treating it as unrestricted', () => {
    expect(() =>
      legacySignupRoleIds(null, roleMap, 'Legacy event event-1'),
    ).toThrow('null legacy signup allow-list');
  });

  it('blocks an unmapped status instead of broadening eligibility', () => {
    expect(() =>
      legacySignupRoleIds(['SPONSOR'], roleMap, 'Legacy event event-1'),
    ).toThrow('SPONSOR without a target role mapping');
  });
});
