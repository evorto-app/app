import { describe, expect, it } from '@effect/vitest';

import { requireSeedRoles, requireSeedUserId } from './seed-requirements';

const roles = [
  {
    defaultOrganizerRole: false,
    defaultUserRole: false,
    id: 'admin-role',
    name: 'Admin',
  },
  {
    defaultOrganizerRole: true,
    defaultUserRole: false,
    id: 'organizer-role',
    name: 'Section member',
  },
  {
    defaultOrganizerRole: false,
    defaultUserRole: true,
    id: 'user-role',
    name: 'Regular user',
  },
];

describe('seed requirements', () => {
  it('returns only explicit required users and role groups', () => {
    expect(
      requireSeedUserId(
        [
          { id: 'first-user', roles: 'none' },
          { id: 'organizer-user', roles: 'organizer' },
        ],
        'organizer',
      ),
    ).toBe('organizer-user');
    expect(requireSeedRoles(roles)).toEqual({
      adminRole: roles[0],
      defaultOrganizerRoles: [roles[1]],
      defaultUserRoles: [roles[2]],
    });
  });

  it('rejects missing required users instead of selecting the first user', () => {
    expect(() =>
      requireSeedUserId([{ id: 'first-user', roles: 'none' }], 'admin'),
    ).toThrow('Missing required seed user with role "admin"');
  });

  it.each([
    {
      missingRoleId: 'admin-role',
      message: 'Missing required Admin seed role',
    },
    {
      missingRoleId: 'organizer-role',
      message: 'Missing required default organizer seed role',
    },
    {
      missingRoleId: 'user-role',
      message: 'Missing required default user seed role',
    },
  ])(
    'rejects an incomplete role graph: $message',
    ({ message, missingRoleId }) => {
      expect(() =>
        requireSeedRoles(roles.filter((role) => role.id !== missingRoleId)),
      ).toThrow(message);
    },
  );
});
