import { readonly, schema } from '@angular/forms/signals';

import {
  ALL_PERMISSIONS,
  Permission,
  PERMISSION_DEPENDENCIES,
} from '../../../../shared/permissions/permissions';

export interface RoleFormData {
  collapseMembersInHup: boolean;
  defaultOrganizerRole: boolean;
  defaultUserRole: boolean;
  description: null | string;
  name: string;
  permissions: Permission[];
  showInHub: boolean;
}

export interface RoleFormModel {
  collapseMembersInHup: boolean;
  defaultOrganizerRole: boolean;
  defaultUserRole: boolean;
  description: string;
  name: string;
  permissions: Record<Permission, boolean>;
  showInHub: boolean;
}

export interface RoleFormOverrides
  extends Partial<Omit<RoleFormModel, 'description' | 'permissions'>> {
  description?: null | string;
  permissions?: Partial<Record<Permission, boolean>> | Permission[];
}

const emptyPermissions = Object.fromEntries(
  ALL_PERMISSIONS.map((permission) => [permission, false]),
) as Record<Permission, boolean>;

const buildPermissions = (
  selected?: Partial<Record<Permission, boolean>> | Permission[],
): Record<Permission, boolean> => {
  const next = { ...emptyPermissions };
  if (Array.isArray(selected)) {
    for (const permission of selected) {
      next[permission] = true;
    }
    return next;
  }
  if (selected) {
    for (const permission of ALL_PERMISSIONS) {
      if (selected[permission] !== undefined) {
        next[permission] = Boolean(selected[permission]);
      }
    }
  }
  return next;
};

export const createRoleFormModel = (
  overrides: RoleFormOverrides = {},
): RoleFormModel => ({
  collapseMembersInHup: overrides.collapseMembersInHup ?? false,
  defaultOrganizerRole: overrides.defaultOrganizerRole ?? false,
  defaultUserRole: overrides.defaultUserRole ?? false,
  description: overrides.description ?? '',
  name: overrides.name ?? '',
  permissions: buildPermissions(overrides.permissions),
  showInHub: overrides.showInHub ?? false,
});

export const mergeRoleFormOverrides = (
  overrides: RoleFormOverrides,
  previous?: RoleFormModel,
): RoleFormModel => {
  const base = previous ?? createRoleFormModel();
  return createRoleFormModel({
    ...base,
    ...overrides,
    description: overrides.description ?? base.description,
    permissions: overrides.permissions ?? base.permissions,
  });
};

export const DEPENDENT_PERMISSION_PARENTS: Record<Permission, Permission[]> = {};
for (const permission of ALL_PERMISSIONS) {
  DEPENDENT_PERMISSION_PARENTS[permission] = [];
}

for (const [permission, dependencies] of Object.entries(
  PERMISSION_DEPENDENCIES,
) as [Permission, Permission[]][]) {
  for (const dependent of dependencies) {
    DEPENDENT_PERMISSION_PARENTS[dependent].push(permission);
  }
}

export const roleFormSchema = schema<RoleFormModel>((form) => {
  for (const permission of ALL_PERMISSIONS) {
    const parents = DEPENDENT_PERMISSION_PARENTS[permission];
    if (parents.length === 0) continue;
    readonly(form.permissions[permission], ({ valueOf }) =>
      parents.some((perm) => valueOf(form.permissions[perm])),
    );
  }
});
