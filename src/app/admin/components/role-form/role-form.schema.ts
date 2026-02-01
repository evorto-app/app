import { disabled, schema } from '@angular/forms/signals';

import {
  ALL_PERMISSIONS,
  Permission,
  PERMISSION_DEPENDENCIES,
} from '../../../../shared/permissions/permissions';

export interface RoleFormModel {
  collapseMembersInHup: boolean;
  defaultOrganizerRole: boolean;
  defaultUserRole: boolean;
  description: string;
  name: string;
  permissions: Record<Permission, boolean>;
  showInHub: boolean;
}

export interface RoleFormData {
  collapseMembersInHup: boolean;
  defaultOrganizerRole: boolean;
  defaultUserRole: boolean;
  description: null | string;
  name: string;
  permissions: Permission[];
  showInHub: boolean;
}

export interface RoleFormOverrides
  extends Partial<Omit<RoleFormModel, 'permissions' | 'description'>> {
  description?: null | string;
  permissions?: Permission[] | Partial<Record<Permission, boolean>>;
}

const emptyPermissions = Object.fromEntries(
  ALL_PERMISSIONS.map((permission) => [permission, false]),
) as Record<Permission, boolean>;

const buildPermissions = (
  selected?: Permission[] | Partial<Record<Permission, boolean>>,
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

const dependentPermissionParents = ALL_PERMISSIONS.reduce(
  (acc, permission) => {
    acc[permission] = [];
    return acc;
  },
  {} as Record<Permission, Permission[]>,
);

for (const [permission, dependencies] of Object.entries(
  PERMISSION_DEPENDENCIES,
) as [Permission, Permission[]][]) {
  for (const dependent of dependencies) {
    dependentPermissionParents[dependent].push(permission);
  }
}

export const roleFormSchema = schema<RoleFormModel>((form) => {
  for (const permission of ALL_PERMISSIONS) {
    const parents = dependentPermissionParents[permission];
    if (parents.length === 0) continue;
    disabled(form.permissions[permission], ({ valueOf }) => {
      const parent = parents.find((perm) => valueOf(form.permissions[perm]));
      return parent ? `Automatically granted by ${parent}` : false;
    });
  }
});
