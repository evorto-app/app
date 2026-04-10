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
];
