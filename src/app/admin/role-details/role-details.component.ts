import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft, faEdit } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import {
  includesPermission,
  PERMISSION_GROUPS,
  type TenantRolePermission,
} from '../../../shared/permissions/permissions';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, MatCardModule, RouterLink],
  selector: 'app-role-details',
  templateUrl: './role-details.component.html',
})
export class RoleDetailsComponent {
  roleId = input.required<string>();
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEdit = faEdit;

  protected readonly permissionGroups = PERMISSION_GROUPS;

  private readonly rpc = AppRpc.injectClient();
  protected readonly roleQuery = injectQuery(() =>
    this.rpc.admin.roles.findOne.queryOptions({
      id: this.roleId(),
    }),
  );

  hasPermission(permission: TenantRolePermission) {
    return includesPermission(
      permission,
      this.roleQuery.data()?.permissions ?? [],
    );
  }

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, "We couldn't load this role.", [
      'AdminRoleNotFoundError',
    ]);
  }
}
