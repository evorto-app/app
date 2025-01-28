import { computed, inject, Injectable } from '@angular/core';

import { Permission } from '../../shared/permissions/permissions';
import { ConfigService } from './config.service';

@Injectable({
  providedIn: 'root',
})
export class PermissionsService {
  private readonly config = inject(ConfigService);
  private readonly permissions = this.config.permissions;
  public hasPermission(...permissions: Permission[]) {
    return computed(() =>
      permissions.every((p) => this.permissions.includes(p)),
    );
  }
  public hasPermissionSync(...permissions: Permission[]) {
    return permissions.every((p) => this.permissions.includes(p));
  }
}
