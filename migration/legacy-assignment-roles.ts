export const legacyAssignmentRoleIds = (
  assignment: {
    readonly role: string;
    readonly status: string;
  },
  roleMap: ReadonlyMap<string, string>,
): string[] => {
  const statusRoleId = roleMap.get(assignment.status);
  if (!statusRoleId) {
    throw new Error(
      `Legacy membership status ${assignment.status} has no target role mapping; migration is blocked.`,
    );
  }
  const roleIds = new Set([statusRoleId]);
  if (assignment.role === 'ADMIN') {
    const adminRoleId = roleMap.get('ADMIN');
    if (!adminRoleId) {
      throw new Error(
        'Legacy ADMIN has no target role mapping; migration is blocked.',
      );
    }
    roleIds.add(adminRoleId);
  } else if (assignment.role !== 'USER') {
    throw new Error(
      `Legacy tenant role ${assignment.role} has no target representation; migration is blocked.`,
    );
  }
  return [...roleIds];
};
