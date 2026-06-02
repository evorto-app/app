import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft, faEdit } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import {
  Permission,
  PERMISSION_GROUPS,
} from '../../../shared/permissions/permissions';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';

export const roleHasPermission = (
  role: { permissions: readonly Permission[] },
  permission: Permission,
): boolean => role.permissions.includes(permission);

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

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Unknown error');
  }

  protected hasPermission(
    role: { permissions: readonly Permission[] },
    permission: Permission,
  ): boolean {
    return roleHasPermission(role, permission);
  }
}
