import {
  faCalendarDay,
  faFileEdit,
  faGear,
  faUser,
} from '@fortawesome/duotone-regular-svg-icons';
import { IconDefinition } from '@fortawesome/fontawesome-svg-core';
import { Schema } from 'effect';

// Define the permission groups as const
const ADMIN_GROUP = {
  key: 'admin',
  permissions: ['analytics', 'billing', 'roles', 'settings'] as const,
} as const;

const EVENTS_GROUP = {
  key: 'events',
  permissions: ['create', 'delete', 'edit', 'registration', 'view'] as const,
} as const;

const TEMPLATES_GROUP = {
  key: 'templates',
  permissions: ['create', 'delete', 'edit', 'view'] as const,
} as const;

const USERS_GROUP = {
  key: 'users',
  permissions: ['create', 'delete', 'edit', 'view'] as const,
} as const;

// Union type of all possible permissions
export type Permission =
  | AdminPermissions
  | EventsPermissions
  | TemplatesPermissions
  | UsersPermissions;
export interface PermissionGroup {
  icon: IconDefinition;
  key: string;
  label: string;
  permissions: PermissionMeta[];
}
export interface PermissionMeta {
  description?: string;
  key: Permission;
  label: string;
}
// Type definitions using the const groups
type AdminPermissions =
  `${typeof ADMIN_GROUP.key}:${(typeof ADMIN_GROUP.permissions)[number]}`;

type EventsPermissions =
  `${typeof EVENTS_GROUP.key}:${(typeof EVENTS_GROUP.permissions)[number]}`;

type TemplatesPermissions =
  `${typeof TEMPLATES_GROUP.key}:${(typeof TEMPLATES_GROUP.permissions)[number]}`;

type UsersPermissions =
  `${typeof USERS_GROUP.key}:${(typeof USERS_GROUP.permissions)[number]}`;

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    icon: faGear,
    key: ADMIN_GROUP.key,
    label: 'Admin',
    permissions: ADMIN_GROUP.permissions.map((perm) => ({
      key: `${ADMIN_GROUP.key}:${perm}` as Permission,
      label: perm.charAt(0).toUpperCase() + perm.slice(1),
    })),
  },
  {
    icon: faCalendarDay,
    key: EVENTS_GROUP.key,
    label: 'Events',
    permissions: EVENTS_GROUP.permissions.map((perm) => ({
      key: `${EVENTS_GROUP.key}:${perm}` as Permission,
      label: perm.charAt(0).toUpperCase() + perm.slice(1),
    })),
  },
  {
    icon: faFileEdit,
    key: TEMPLATES_GROUP.key,
    label: 'Templates',
    permissions: TEMPLATES_GROUP.permissions.map((perm) => ({
      key: `${TEMPLATES_GROUP.key}:${perm}` as Permission,
      label: perm.charAt(0).toUpperCase() + perm.slice(1),
    })),
  },
  {
    icon: faUser,
    key: USERS_GROUP.key,
    label: 'Users',
    permissions: USERS_GROUP.permissions.map((perm) => ({
      key: `${USERS_GROUP.key}:${perm}` as Permission,
      label: perm.charAt(0).toUpperCase() + perm.slice(1),
    })),
  },
] as const;

// Type-safe permissions record
export const PERMISSIONS = {
  ADMIN: Object.fromEntries(
    ADMIN_GROUP.permissions.map((perm) => [
      perm.toUpperCase(),
      `${ADMIN_GROUP.key}:${perm}` as Permission,
    ]),
  ),
  EVENTS: Object.fromEntries(
    EVENTS_GROUP.permissions.map((perm) => [
      perm.toUpperCase(),
      `${EVENTS_GROUP.key}:${perm}` as Permission,
    ]),
  ),
  TEMPLATES: Object.fromEntries(
    TEMPLATES_GROUP.permissions.map((perm) => [
      perm.toUpperCase(),
      `${TEMPLATES_GROUP.key}:${perm}` as Permission,
    ]),
  ),
  USERS: Object.fromEntries(
    USERS_GROUP.permissions.map((perm) => [
      perm.toUpperCase(),
      `${USERS_GROUP.key}:${perm}` as Permission,
    ]),
  ),
} as const;

// Get all permission keys as a flat array with proper typing
export const ALL_PERMISSIONS = PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((perm) => perm.key),
) satisfies Permission[];

export const PermissionSchema = Schema.declare(
  (input: unknown): input is Permission => {
    if (typeof input !== 'string') {
      return false;
    }
    return ALL_PERMISSIONS.includes(input as Permission);
  },
);