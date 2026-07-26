export type RequiredSeedUserRole = 'admin' | 'organizer' | 'user';

export interface SeedRole {
  readonly defaultOrganizerRole: boolean;
  readonly defaultUserRole: boolean;
  readonly id: string;
  readonly name: string;
}

export const requireSeedUserId = (
  users: readonly { readonly id: string; readonly roles: string }[],
  role: RequiredSeedUserRole,
): string => {
  const user = users.find((candidate) => candidate.roles === role);
  if (!user?.id) {
    throw new Error(`Missing required seed user with role "${role}"`);
  }
  return user.id;
};

export const requireSeedRoles = <TRole extends SeedRole>(
  roles: readonly TRole[],
): {
  readonly adminRole: TRole;
  readonly defaultOrganizerRoles: TRole[];
  readonly defaultUserRoles: TRole[];
} => {
  const adminRole = roles.find((role) => role.name === 'Admin');
  if (!adminRole) {
    throw new Error('Missing required Admin seed role');
  }

  const defaultOrganizerRoles = roles.filter(
    (role) => role.defaultOrganizerRole,
  );
  if (defaultOrganizerRoles.length === 0) {
    throw new Error('Missing required default organizer seed role');
  }

  const defaultUserRoles = roles.filter((role) => role.defaultUserRole);
  if (defaultUserRoles.length === 0) {
    throw new Error('Missing required default user seed role');
  }

  return { adminRole, defaultOrganizerRoles, defaultUserRoles };
};
