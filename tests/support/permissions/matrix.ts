import type { Permission } from '../../../src/shared/permissions/permissions';

import { adminStateFile, organizerStateFile } from '../../../helpers/user-data';
import type { PermissionDiff } from '../utils/permissions-override';

export interface PermissionMatrixCase {
  allowedDiff: PermissionDiff;
  allowedRoute: string;
  capability: string;
  deniedDiff: PermissionDiff;
  deniedRoute: string;
  requiredPermissions: Permission[];
  storageState: string;
}

export const permissionMatrix: PermissionMatrixCase[] = [
  {
    allowedDiff: {
      add: ['admin:tax'],
      remove: [],
      roleName: 'Admin',
    },
    allowedRoute: '/admin/tax-rates',
    capability: 'admin tax rates access',
    deniedDiff: {
      add: [],
      remove: ['admin:tax'],
      roleName: 'Admin',
    },
    deniedRoute: '/admin/tax-rates',
    requiredPermissions: ['admin:tax'],
    storageState: adminStateFile,
  },
  {
    allowedDiff: {
      add: ['templates:create', 'templates:view'],
      remove: [],
      roleName: 'Section member',
    },
    allowedRoute: '/templates/create',
    capability: 'template creation access',
    deniedDiff: {
      add: ['templates:view'],
      remove: ['templates:create'],
      roleName: 'Section member',
    },
    deniedRoute: '/templates/create',
    requiredPermissions: ['templates:create', 'templates:view'],
    storageState: organizerStateFile,
  },
  {
    allowedDiff: {
      add: ['admin:manageRoles'],
      remove: [],
      roleName: 'Admin',
    },
    allowedRoute: '/admin/roles',
    capability: 'admin role management access',
    deniedDiff: {
      add: [],
      remove: ['admin:manageRoles'],
      roleName: 'Admin',
    },
    deniedRoute: '/admin/roles',
    requiredPermissions: ['admin:manageRoles'],
    storageState: adminStateFile,
  },
  {
    allowedDiff: {
      add: ['admin:changeSettings'],
      remove: [],
      roleName: 'Admin',
    },
    allowedRoute: '/admin/settings',
    capability: 'admin general settings access',
    deniedDiff: {
      add: [],
      remove: ['admin:changeSettings'],
      roleName: 'Admin',
    },
    deniedRoute: '/admin/settings',
    requiredPermissions: ['admin:changeSettings'],
    storageState: adminStateFile,
  },
  {
    allowedDiff: {
      add: ['users:viewAll'],
      remove: [],
      roleName: 'Admin',
    },
    allowedRoute: '/admin/users',
    capability: 'admin user list access',
    deniedDiff: {
      add: [],
      remove: ['users:viewAll'],
      roleName: 'Admin',
    },
    deniedRoute: '/admin/users',
    requiredPermissions: ['users:viewAll'],
    storageState: adminStateFile,
  },
  {
    allowedDiff: {
      add: ['finance:viewTransactions'],
      remove: [],
      roleName: 'Admin',
    },
    allowedRoute: '/finance/transactions',
    capability: 'finance transaction list access',
    deniedDiff: {
      add: [],
      remove: ['finance:viewTransactions'],
      roleName: 'Admin',
    },
    deniedRoute: '/finance/transactions',
    requiredPermissions: ['finance:viewTransactions'],
    storageState: adminStateFile,
  },
  {
    allowedDiff: {
      add: ['finance:approveReceipts'],
      remove: [],
      roleName: 'Admin',
    },
    allowedRoute: '/finance/receipts-approval',
    capability: 'finance receipt approval access',
    deniedDiff: {
      add: [],
      remove: ['finance:approveReceipts'],
      roleName: 'Admin',
    },
    deniedRoute: '/finance/receipts-approval',
    requiredPermissions: ['finance:approveReceipts'],
    storageState: adminStateFile,
  },
  {
    allowedDiff: {
      add: ['finance:refundReceipts'],
      remove: [],
      roleName: 'Admin',
    },
    allowedRoute: '/finance/receipts-refunds',
    capability: 'finance receipt refund access',
    deniedDiff: {
      add: [],
      remove: ['finance:refundReceipts'],
      roleName: 'Admin',
    },
    deniedRoute: '/finance/receipts-refunds',
    requiredPermissions: ['finance:refundReceipts'],
    storageState: adminStateFile,
  },
  {
    allowedDiff: {
      add: ['templates:editAll', 'templates:view'],
      remove: [],
      roleName: 'Section member',
    },
    allowedRoute: '/templates/route-guard-placeholder/edit',
    capability: 'template edit route access',
    deniedDiff: {
      add: ['templates:view'],
      remove: ['templates:editAll'],
      roleName: 'Section member',
    },
    deniedRoute: '/templates/route-guard-placeholder/edit',
    requiredPermissions: ['templates:editAll', 'templates:view'],
    storageState: organizerStateFile,
  },
  {
    allowedDiff: {
      add: ['events:create'],
      remove: [],
      roleName: 'Section member',
    },
    allowedRoute: '/templates/route-guard-placeholder/create-event',
    capability: 'template create-event route access',
    deniedDiff: {
      add: ['templates:view'],
      remove: ['events:create'],
      roleName: 'Section member',
    },
    deniedRoute: '/templates/route-guard-placeholder/create-event',
    requiredPermissions: ['events:create'],
    storageState: organizerStateFile,
  },
];
