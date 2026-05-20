import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import consola from 'consola/browser';

import { Permission } from '../../../shared/permissions/permissions';
import { PermissionsService } from '../permissions.service';

const logger = consola.withTag('app/permission-guard');

export const permissionGuard: CanActivateFn = (route, state) => {
  const permissionsService = inject(PermissionsService);
  const router = inject(Router);
  const permissions = (route.data['permissions'] ?? []) as Permission[];
  const anyPermissions = (route.data['anyPermissions'] ?? []) as Permission[];
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
