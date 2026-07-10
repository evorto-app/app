import {
  faCalendarDay,
  faFileEdit,
  faGear,
  faLock,
  faMoneyBill,
  faUser,
} from '@fortawesome/duotone-regular-svg-icons';
import { IconDefinition } from '@fortawesome/fontawesome-common-types';
import { Schema } from 'effect';

// Define the permission groups as const
const ADMIN_GROUP = {
  key: 'admin',
  permissions: ['manageRoles', 'changeSettings', 'tax'] as const,
} as const;

const EVENTS_GROUP = {
  key: 'events',
  permissions: [
    'changeListing',
    'cancelRegistrations',
    'create',
    'editAll',
    'review',
    'organizeAll',
    'seeDrafts',
    'seeUnlisted',
    'viewPublic',
  ] as const,
} as const;

const TEMPLATES_GROUP = {
  key: 'templates',
  permissions: [
    'create',
    'delete',
    'editAll',
    'manageCategories',
    'view',
  ] as const,
} as const;

const USERS_GROUP = {
  key: 'users',
  permissions: ['viewAll', 'assignRoles'] as const,
} as const;

const INTERNAL_GROUP = {
  key: 'internal',
  permissions: ['viewInternalPages'] as const,
} as const;

const FINANCE_GROUP = {
  key: 'finance',
  permissions: [
    'approveReceipts',
    'manageReceipts',
    'createTransactions',
    'refundReceipts',
    'viewTransactions',
  ] as const,
} as const;

// Union type of all effective permissions and permission checks.
export type Permission =
  | AdminPermissions
  | AdminPermissionsLegacy
  | EventsPermissions
  | FinancePermissions
  | GlobalAdminPermissions
  | InternalPermissions
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
  key: TenantRolePermission;
  label: string;
}

// Tenant roles may grant tenant-scoped capabilities and tenant-group
// wildcards. Platform globals are resolved outside tenant role persistence.
export type TenantRolePermission = Exclude<Permission, GlobalAdminPermissions>;

// Type definitions using the const groups

type AdminPermissions =
  | `${typeof ADMIN_GROUP.key}:${(typeof ADMIN_GROUP.permissions)[number]}`
  | `${typeof ADMIN_GROUP.key}:*`;
type AdminPermissionsLegacy = 'admin:manageTaxes';

type EventsPermissions =
  | `${typeof EVENTS_GROUP.key}:${(typeof EVENTS_GROUP.permissions)[number]}`
  | `${typeof EVENTS_GROUP.key}:*`;

type FinancePermissions =
  | `${typeof FINANCE_GROUP.key}:${(typeof FINANCE_GROUP.permissions)[number]}`
  | `${typeof FINANCE_GROUP.key}:*`;

type GlobalAdminPermissions = `globalAdmin:*` | `globalAdmin:manageTenants`;

type InternalPermissions =
  | `${typeof INTERNAL_GROUP.key}:${(typeof INTERNAL_GROUP.permissions)[number]}`
  | `${typeof INTERNAL_GROUP.key}:*`;

type TemplatesPermissions =
  | `${typeof TEMPLATES_GROUP.key}:${(typeof TEMPLATES_GROUP.permissions)[number]}`
  | `${typeof TEMPLATES_GROUP.key}:*`;

type UsersPermissions =
  | `${typeof USERS_GROUP.key}:${(typeof USERS_GROUP.permissions)[number]}`
  | `${typeof USERS_GROUP.key}:*`;

const PERMISSION_METADATA = {
  'admin:changeSettings': {
    description:
      'Update tenant-wide operational settings such as theme, receipt countries, and discount provider configuration.',
    label: 'Change tenant settings',
  },
  'admin:manageRoles': {
    description:
      'Create, update, and delete tenant roles and the permissions granted by those roles.',
    label: 'Manage roles',
  },
  'admin:tax': {
    description:
      'Manage tenant tax rates used for paid registration options and Stripe tax-rate imports.',
    label: 'Manage tax rates',
  },
  'events:cancelRegistrations': {
    description:
      'Cancel attendee registrations or unredeemed event add-ons and choose whether eligible add-on purchases should be refunded.',
    label: 'Cancel registrations and add-ons',
  },
  'events:changeListing': {
    description:
      'Change whether events are listed publicly or kept unlisted for direct-link access.',
    label: 'Change event listing',
  },
  'events:create': {
    description:
      'Create events from scratch or from templates for the current tenant.',
    label: 'Create events',
  },
  'events:editAll': {
    description:
      'Edit tenant events even when the current user is not the event creator or organizer.',
    label: 'Edit all events',
  },
  'events:organizeAll': {
    description:
      'Open organizer views, manage event receipts, and check in attendees for any tenant event.',
    label: 'Organize all events',
  },
  'events:review': {
    description:
      'Review submitted events and approve or reject them for publication.',
    label: 'Review events',
  },
  'events:seeDrafts': {
    description:
      'See draft and pending-review events that are hidden from normal public event lists.',
    label: 'See draft events',
  },
  'events:seeUnlisted': {
    description: 'See unlisted events without needing a direct event link.',
    label: 'See unlisted events',
  },
  'events:viewPublic': {
    description:
      'View approved public event details and event lists for the current tenant.',
    label: 'View public events',
  },
  'finance:approveReceipts': {
    description:
      'Review submitted receipts and approve or reject them for reimbursement.',
    label: 'Approve receipts',
  },
  'finance:createTransactions': {
    description:
      'Create manual finance transactions for tenant bookkeeping workflows.',
    label: 'Create transactions',
  },
  'finance:manageReceipts': {
    description:
      'Manage event receipts broadly, including receipt submission support for tenant events.',
    label: 'Manage receipts',
  },
  'finance:refundReceipts': {
    description:
      'Record manual reimbursement transactions for approved receipts.',
    label: 'Record receipt reimbursements',
  },
  'finance:viewTransactions': {
    description:
      'View tenant finance transactions, amounts, payment methods, fees, and comments.',
    label: 'View transactions',
  },
  'internal:viewInternalPages': {
    description:
      'Open internal diagnostics and development-only pages when they are available.',
    label: 'View internal pages',
  },
  'templates:create': {
    description:
      'Create reusable event templates and their organizer/participant registration defaults.',
    label: 'Create templates',
  },
  'templates:delete': {
    description: 'Delete reusable event templates from the current tenant.',
    label: 'Delete templates',
  },
  'templates:editAll': {
    description:
      'Edit reusable event templates regardless of who originally created them.',
    label: 'Edit all templates',
  },
  'templates:manageCategories': {
    description:
      'Create and edit the categories used to organize reusable event templates.',
    label: 'Manage template categories',
  },
  'templates:view': {
    description:
      'View reusable event templates and use them while creating events.',
    label: 'View templates',
  },
  'users:assignRoles': {
    description:
      'Assign any existing tenant role to any tenant user, including yourself. Treat this as full tenant-administrator authority because assigned roles can grant every tenant capability.',
    label: 'Assign all user roles (tenant admin)',
  },
  'users:viewAll': {
    description:
      'View the tenant user list, including profile names, email addresses, and role names.',
    label: 'View all users',
  },
} satisfies Record<
  Exclude<TenantRolePermission, 'admin:manageTaxes' | `${string}:*`>,
  Omit<PermissionMeta, 'key'>
>;

const permissionMeta = (key: TenantRolePermission): PermissionMeta => ({
  key,
  ...PERMISSION_METADATA[key as keyof typeof PERMISSION_METADATA],
});

export const permissionLabel = (permission: Permission): string =>
  PERMISSION_METADATA[permission as keyof typeof PERMISSION_METADATA]?.label ??
  permission;

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    icon: faGear,
    key: ADMIN_GROUP.key,
    label: 'Admin',
    permissions: ADMIN_GROUP.permissions.map((perm) =>
      permissionMeta(`${ADMIN_GROUP.key}:${perm}` as TenantRolePermission),
    ),
  },
  {
    icon: faLock,
    key: INTERNAL_GROUP.key,
    label: 'Internal',
    permissions: INTERNAL_GROUP.permissions.map((perm) =>
      permissionMeta(`${INTERNAL_GROUP.key}:${perm}` as TenantRolePermission),
    ),
  },
  {
    icon: faCalendarDay,
    key: EVENTS_GROUP.key,
    label: 'Events',
    permissions: EVENTS_GROUP.permissions.map((perm) =>
      permissionMeta(`${EVENTS_GROUP.key}:${perm}` as TenantRolePermission),
    ),
  },
  {
    icon: faFileEdit,
    key: TEMPLATES_GROUP.key,
    label: 'Templates',
    permissions: TEMPLATES_GROUP.permissions.map((perm) =>
      permissionMeta(`${TEMPLATES_GROUP.key}:${perm}` as TenantRolePermission),
    ),
  },
  {
    icon: faUser,
    key: USERS_GROUP.key,
    label: 'Users',
    permissions: USERS_GROUP.permissions.map((perm) =>
      permissionMeta(`${USERS_GROUP.key}:${perm}` as TenantRolePermission),
    ),
  },
  {
    icon: faMoneyBill,
    key: FINANCE_GROUP.key,
    label: 'Finance',
    permissions: FINANCE_GROUP.permissions.map((perm) =>
      permissionMeta(`${FINANCE_GROUP.key}:${perm}` as TenantRolePermission),
    ),
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
  FINANCE: Object.fromEntries(
    FINANCE_GROUP.permissions.map((perm) => [
      perm.toUpperCase(),
      `${FINANCE_GROUP.key}:${perm}` as Permission,
    ]),
  ),
  INTERNAL: Object.fromEntries(
    INTERNAL_GROUP.permissions.map((perm) => [
      perm.toUpperCase(),
      `${INTERNAL_GROUP.key}:${perm}` as Permission,
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
) satisfies TenantRolePermission[];

const TENANT_ROLE_PERMISSION_LITERALS = [
  'admin:manageTaxes',
  'admin:*',
  'events:*',
  'finance:*',
  'internal:*',
  'templates:*',
  'users:*',
  ...ALL_PERMISSIONS,
] as const satisfies readonly TenantRolePermission[];

export const TenantRolePermissionSchema = Schema.Union(
  TENANT_ROLE_PERMISSION_LITERALS.map((permission) =>
    Schema.Literal(permission),
  ),
);

const isPlatformGlobalPermission = (
  permission: Permission,
): permission is GlobalAdminPermissions =>
  permission === 'globalAdmin:*' || permission === 'globalAdmin:manageTenants';

export const partitionTenantRolePermissions = (
  permissions: readonly Permission[],
): {
  accepted: TenantRolePermission[];
  rejected: GlobalAdminPermissions[];
} => {
  const accepted: TenantRolePermission[] = [];
  const rejected: GlobalAdminPermissions[] = [];

  for (const permission of permissions) {
    if (isPlatformGlobalPermission(permission)) {
      rejected.push(permission);
    } else {
      accepted.push(permission);
    }
  }

  return { accepted, rejected };
};

const PERMISSION_LITERALS = [
  ...TENANT_ROLE_PERMISSION_LITERALS,
  'globalAdmin:*',
  'globalAdmin:manageTenants',
] as const satisfies readonly Permission[];

export const PermissionSchema = Schema.Union(
  PERMISSION_LITERALS.map((permission) => Schema.Literal(permission)),
);

export const PERMISSION_DEPENDENCIES: Partial<
  Record<TenantRolePermission, TenantRolePermission[]>
> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((group) =>
    group.permissions.map((perm) => {
      switch (perm.key) {
        case 'events:changeListing': {
          return [perm.key, ['events:seeUnlisted']];
        }
        case 'events:create': {
          return [perm.key, ['templates:view']];
        }
        case 'events:review': {
          return [perm.key, ['events:seeDrafts', 'events:seeUnlisted']];
        }
        case 'users:assignRoles': {
          return [perm.key, ['users:viewAll']];
        }
        default: {
          return [perm.key, []];
        }
      }
    }),
  ),
) as Partial<Record<TenantRolePermission, TenantRolePermission[]>>;

export const includesPermission = (
  permission: Permission,
  permissions: readonly Permission[],
): boolean => {
  if (permission === 'admin:tax' && permissions.includes('admin:manageTaxes')) {
    return true;
  }

  if (permission.includes(':*')) {
    const [group] = permission.split(':');
    if (permissions.some((granted) => granted.startsWith(`${group}:`))) {
      return true;
    }
  } else if (permissions.includes(permission)) {
    return true;
  }

  const [group] = permission.split(':');
  if (permissions.includes(`${group}:*` as Permission)) {
    return true;
  }

  if (isPlatformGlobalPermission(permission)) {
    return false;
  }

  return Object.entries(PERMISSION_DEPENDENCIES).some(
    ([parentPermission, childPermissions]) =>
      permissions.includes(parentPermission as Permission) &&
      childPermissions.includes(permission),
  );
};
