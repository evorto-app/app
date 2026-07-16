export const legacySignupRoleIds = (
  statuses: null | readonly string[],
  roleMap: ReadonlyMap<string, string>,
  context: string,
): string[] => {
  if (statuses === null) {
    throw new Error(
      `${context} has a null legacy signup allow-list; migration is blocked.`,
    );
  }

  const roleIds = new Set<string>();
  for (const status of statuses) {
    const roleId = roleMap.get(status);
    if (!roleId) {
      throw new Error(
        `${context} uses legacy signup status ${status} without a target role mapping; migration is blocked.`,
      );
    }
    roleIds.add(roleId);
  }
  return [...roleIds];
};
