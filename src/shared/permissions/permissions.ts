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
  permissions: [
    'manageRoles',
    'changeSettings',
    'managePayments',
    'tax',
  ] as const,
} as const;

const EVENTS_GROUP = {
  key: 'events',
  permissions: [
    'changeAnnouncementDiscovery',
    'cancelRegistrations',
    'create',
    'editAll',
    'review',
    'organizeAll',
    'seeDrafts',
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
      'Change organization details, sign-up rules, appearance, legal pages, and time zone.',
    label: 'Change organization settings',
  },
  'admin:managePayments': {
    description:
      'View whether paid sign-ups are ready, and manage currency, accepted receipt countries, cancellation refund fees, and ESNcard discounts.',
    label: 'Manage payments',
  },
  'admin:manageRoles': {
    description:
      'Create, change, and delete organization roles, and choose what each role can do.',
    label: 'Manage roles',
  },
  'admin:tax': {
    description:
      'Manage the tax rates used for paid sign-up choices and add available tax rates to Evorto.',
    label: 'Manage tax rates',
  },
  'events:cancelRegistrations': {
    description:
      'Cancel attendee tickets or unused event add-ons, with an optional refund when one is available.',
    label: 'Cancel tickets and add-ons',
  },
  'events:changeAnnouncementDiscovery': {
    description:
      'Choose which organization roles can find announcements without sign-up choices. People with a direct link can still open them, and this choice does not give members new permissions or send them a message.',
    label: 'Change who can find announcements',
  },
  'events:create': {
    description: 'Create events from templates for the current organization.',
    label: 'Create events',
  },
  'events:editAll': {
    description:
      'Edit organization events even when you did not create or organize them.',
    label: 'Edit all events',
  },
  'events:organizeAll': {
    description:
      'Open organizer views, manage event receipts, and check in attendees for any organization event.',
    label: 'Organize all events',
  },
  'events:review': {
    description:
      'Review submitted events and publish them or return them with feedback.',
    label: 'Review events',
  },
  'events:seeDrafts': {
    description:
      'See drafts and events waiting for review that are hidden from normal event lists.',
    label: 'See draft events',
  },
  'events:viewPublic': {
    description:
      'Open published event details and Events. The list still shows only sign-up events with a choice available to one of your roles and announcements selected for one of your roles.',
    label: 'View public events',
  },
  'finance:approveReceipts': {
    description:
      'Review submitted receipts and approve or reject them for reimbursement.',
    label: 'Approve receipts',
  },
  'finance:createTransactions': {
    description: 'Record money received or spent outside Evorto payments.',
    label: 'Record money received or spent',
  },
  'finance:manageReceipts': {
    description: 'View and submit receipts for any organization event.',
    label: 'Manage receipts',
  },
  'finance:refundReceipts': {
    description: 'Record when an approved receipt has been reimbursed.',
    label: 'Record receipt reimbursements',
  },
  'finance:viewTransactions': {
    description:
      'View money received and spent, including amounts, payment methods, fees, and comments.',
    label: 'View money received and spent',
  },
  'internal:viewInternalPages': {
    description:
      'Open Members Hub to see organization roles and members that are marked for display there.',
    label: 'View Members Hub',
  },
  'templates:create': {
    description:
      'Create reusable event templates with default sign-up choices.',
    label: 'Create templates',
  },
  'templates:delete': {
    description:
      'Delete reusable event templates from the current organization.',
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
      'Assign any organization role to any member, including yourself. This gives full organization-administrator access because roles can allow every organization action.',
    label: 'Assign all member roles (organization admin)',
  },
  'users:viewAll': {
    description:
      'View the organization member list, including profile names, email addresses, and role names.',
    label: 'View all members',
  },
} satisfies Record<
  Exclude<TenantRolePermission, `${string}:*`>,
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
    label: 'Members Hub',
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
    label: 'Members',
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
        case 'events:create': {
          return [perm.key, ['templates:view']];
        }
        case 'events:review': {
          return [perm.key, ['events:seeDrafts']];
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
  if (permission.includes(':*')) {
    const [group] = permission.split(':', 1);
    if (permissions.some((granted) => granted.startsWith(`${group}:`))) {
      return true;
    }
  } else if (permissions.includes(permission)) {
    return true;
  }

  const [group] = permission.split(':', 1);
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
