import { computed, inject, Injectable } from '@angular/core';

import {
  includesPermission,
  Permission,
} from '../../shared/permissions/permissions';
import { ConfigService } from './config.service';

@Injectable({
  providedIn: 'root',
})
export class PermissionsService {
  private readonly config = inject(ConfigService);

  public hasPermission(...permissions: Permission[]) {
    return computed(() =>
      permissions.every((p) => includesPermission(p, this.config.permissions)),
    );
  }

  public hasPermissionSync(...permissions: Permission[]) {
    return permissions.every((p) =>
      includesPermission(p, this.config.permissions),
    );
  }
}
