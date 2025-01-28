import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

import { Permission } from '../../../shared/permissions/permissions';
import { PermissionsService } from '../permissions.service';

export const permissionGuard: CanActivateFn = (route, state) => {
  const permissionsService = inject(PermissionsService);
  const router = inject(Router);
  const permissions = route.data['permissions'] as Permission[];
  if (!permissions || permissions.length === 0) {
    console.warn('No permissions data');
    return true;
  }
  const hasPermission = permissionsService.hasPermissionSync(...permissions);
  if (!hasPermission) {
    console.warn('No permission', permissions);
    return router.createUrlTree(['403', { originalPath: state.url }]);
  }
  return hasPermission;
};
