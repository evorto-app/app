import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import consola from 'consola/browser';

import { Permission } from '../../../shared/permissions/permissions';
import { PermissionsService } from '../permissions.service';

const logger = consola.withTag('app/permission-guard');

const isPermission = (value: unknown): value is Permission =>
  typeof value === 'string';

const readPermissions = (value: unknown): null | Permission[] =>
  Array.isArray(value) && value.every(isPermission) ? value : null;

export const permissionGuard: CanActivateFn = (route, state) => {
  const permissionsService = inject(PermissionsService);
  const router = inject(Router);
  const hasPermissionsData = Object.hasOwn(route.data, 'permissions');
  const hasAnyPermissionsData = Object.hasOwn(route.data, 'anyPermissions');
  const permissions = hasPermissionsData
    ? readPermissions(route.data['permissions'])
    : [];
  const anyPermissions = hasAnyPermissionsData
    ? readPermissions(route.data['anyPermissions'])
    : [];
  if (permissions === null || anyPermissions === null) {
    logger.warn('Invalid permissions data');
    return router.createUrlTree(['/403'], {
      queryParams: { originalPath: state.url },
    });
  }
  if (permissions.length === 0 && anyPermissions.length === 0) {
    logger.warn('No permissions data');
    return true;
  }
  const hasPermission =
    (permissions.length === 0 ||
      permissionsService.hasPermissionSync(...permissions)) &&
    (anyPermissions.length === 0 ||
      anyPermissions.some((permission) =>
        permissionsService.hasPermissionSync(permission),
      ));
  if (!hasPermission) {
    logger.warn('No permission', { anyPermissions, permissions });
    return router.createUrlTree(['/403'], {
      queryParams: { originalPath: state.url },
    });
  }
  return hasPermission;
};
