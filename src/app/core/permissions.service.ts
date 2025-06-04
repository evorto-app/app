import { computed, inject, Injectable } from '@angular/core';

import {
  Permission,
  PERMISSION_DEPENDENCIES,
} from '../../shared/permissions/permissions';
import { ConfigService } from './config.service';

@Injectable({
  providedIn: 'root',
})
export class PermissionsService {
  private readonly config = inject(ConfigService);
  private readonly permissions = this.config.permissions;

  public hasPermission(...permissions: Permission[]) {
    return computed(() =>
      permissions.every((p) => this.includesPermission(p, this.permissions)),
    );
  }

  public hasPermissionSync(...permissions: Permission[]) {
    return permissions.every((p) =>
      this.includesPermission(p, this.permissions),
    );
  }

  private includesPermission(
    permission: Permission,
    permissions: Permission[],
  ) {
    // First check if the permission is directly granted
    if (permission.includes(':*')) {
      const [group] = permission.split(':');
      if (permissions.some((p) => p.includes(`${group}:`))) {
        return true;
      }
    } else if (permissions.includes(permission)) {
      return true;
    }

    // Then check if any dependency grants this permission
    for (const [parentPerm, childPerms] of Object.entries(
      PERMISSION_DEPENDENCIES,
    )) {
      if (
        permissions.includes(parentPerm as Permission) &&
        childPerms.includes(permission)
      ) {
        return true;
      }
    }

    return false;
  }
}
