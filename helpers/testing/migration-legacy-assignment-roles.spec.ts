import { describe, expect, it } from 'vitest';

import { legacyAssignmentRoleIds } from '../../migration/legacy-assignment-roles';

const roleMap = new Map([
  ['ADMIN', 'admin-role'],
  ['FULL', 'full-role'],
  ['NONE', 'none-role'],
]);

describe('legacy tenant assignment roles', () => {
  it('assigns only the exact legacy membership status role', () => {
    expect(
      legacyAssignmentRoleIds({ role: 'USER', status: 'FULL' }, roleMap),
    ).toEqual(['full-role']);
    expect(
      legacyAssignmentRoleIds({ role: 'USER', status: 'FULL' }, roleMap),
    ).not.toContain('none-role');
  });

  it('adds admin authority without adding the NONE role', () => {
    expect(
      legacyAssignmentRoleIds({ role: 'ADMIN', status: 'FULL' }, roleMap),
    ).toEqual(['full-role', 'admin-role']);
  });

  it('blocks unmapped statuses and tenant roles', () => {
    expect(() =>
      legacyAssignmentRoleIds({ role: 'USER', status: 'SPONSOR' }, roleMap),
    ).toThrow('SPONSOR has no target role mapping');
    expect(() =>
      legacyAssignmentRoleIds({ role: 'OWNER', status: 'FULL' }, roleMap),
    ).toThrow('OWNER has no target representation');
  });
});
