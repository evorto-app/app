import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft, faEdit } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { Permission, PERMISSION_GROUPS } from '../../../shared/permissions/permissions';
import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FontAwesomeModule, MatButtonModule, MatCardModule, MatIconModule, RouterLink],
  selector: 'app-role-details',
  standalone: true,
  templateUrl: './role-details.component.html',
})
export class RoleDetailsComponent {
  roleId = input.required<string>();
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEdit = faEdit;

  protected readonly permissionGroups = PERMISSION_GROUPS;

  private readonly trpc = injectTRPC();
  protected readonly roleQuery = injectQuery(() =>
    this.trpc.admin.roles.findOne.queryOptions({
      id: this.roleId(),
    }),
  );

  hasPermission(permission: Permission) {
    return this.roleQuery.data()?.permissions.includes(permission) ?? false;
  }
}
