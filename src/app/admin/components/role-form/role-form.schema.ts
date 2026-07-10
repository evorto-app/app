import { readonly, required, schema } from '@angular/forms/signals';

import {
  ALL_PERMISSIONS,
  PERMISSION_DEPENDENCIES,
  TenantRolePermission,
} from '../../../../shared/permissions/permissions';

export interface RoleFormData {
  collapseMembersInHup: boolean;
  defaultOrganizerRole: boolean;
  defaultUserRole: boolean;
  description: null | string;
  displayInHub: boolean;
  name: string;
  permissions: TenantRolePermission[];
}

export interface RoleFormModel {
  collapseMembersInHup: boolean;
  defaultOrganizerRole: boolean;
  defaultUserRole: boolean;
  description: string;
  displayInHub: boolean;
  name: string;
  permissions: Record<TenantRolePermission, boolean>;
}

export interface RoleFormOverrides extends Partial<
  Omit<RoleFormModel, 'description' | 'permissions'>
> {
  description?: null | string;
  permissions?:
    Partial<Record<TenantRolePermission, boolean>> | TenantRolePermission[];
}

const emptyPermissions = Object.fromEntries(
  ALL_PERMISSIONS.map((permission) => [permission, false]),
) as Record<TenantRolePermission, boolean>;

const buildPermissions = (
  selected?:
    Partial<Record<TenantRolePermission, boolean>> | TenantRolePermission[],
): Record<TenantRolePermission, boolean> => {
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
  displayInHub: overrides.displayInHub ?? false,
  name: overrides.name ?? '',
  permissions: buildPermissions(overrides.permissions),
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

export const DEPENDENT_PERMISSION_PARENTS = Object.fromEntries(
  ALL_PERMISSIONS.map((permission) => [
    permission,
    [] as TenantRolePermission[],
  ]),
) as Record<TenantRolePermission, TenantRolePermission[]>;

for (const [permission, dependencies] of Object.entries(
  PERMISSION_DEPENDENCIES,
) as [TenantRolePermission, TenantRolePermission[]][]) {
  for (const dependent of dependencies) {
    DEPENDENT_PERMISSION_PARENTS[dependent].push(permission);
  }
}

export const roleFormSchema = schema<RoleFormModel>((form) => {
  required(form.name);

  for (const permission of ALL_PERMISSIONS) {
    const parents = DEPENDENT_PERMISSION_PARENTS[permission];
    if (parents.length === 0) continue;
    readonly(form.permissions[permission], ({ valueOf }) =>
      parents.some((perm) => valueOf(form.permissions[perm])),
    );
  }
});
