import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faCalendarDay,
  faEdit,
  faFileEdit,
  faGear,
  faUser,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    RouterLink,
    MatIconModule,
  ],
  selector: 'app-role-details',
  templateUrl: './role-details.component.html',
})
export class RoleDetailsComponent {
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEdit = faEdit;
  protected readonly roleId = input.required<string>();
  private readonly queries = inject(QueriesService);
  protected readonly roleQuery = injectQuery(this.queries.role(this.roleId));

  protected readonly permissionGroups = computed(() => {
    const role = this.roleQuery.data();
    if (!role) return [];

    return [
      {
        icon: faGear,
        label: 'Admin',
        permissions: [
          {
            enabled: role.permissionAdminAnalytics,

            label: 'Analytics',
          },
          {
            enabled: role.permissionAdminBilling,

            label: 'Billing',
          },
          {
            enabled: role.permissionAdminRoles,

            label: 'Roles',
          },
          {
            enabled: role.permissionAdminSettings,

            label: 'Settings',
          },
        ],
      },
      {
        icon: faCalendarDay,
        label: 'Events',
        permissions: [
          {
            enabled: role.permissionEventCreate,
            label: 'Create',
          },
          {
            enabled: role.permissionEventDelete,
            label: 'Delete',
          },
          {
            enabled: role.permissionEventEdit,
            label: 'Edit',
          },
          {
            enabled: role.permissionEventRegistrationManage,
            label: 'Manage Registrations',
          },
          {
            enabled: role.permissionEventView,
            label: 'View',
          },
        ],
      },
      {
        icon: faFileEdit,
        label: 'Templates',
        permissions: [
          {
            enabled: role.permissionTemplateCreate,
            label: 'Create',
          },
          {
            enabled: role.permissionTemplateDelete,
            label: 'Delete',
          },
          {
            enabled: role.permissionTemplateEdit,
            label: 'Edit',
          },
          {
            enabled: role.permissionTemplateView,
            label: 'View',
          },
        ],
      },
      {
        icon: faUser,
        label: 'Users',
        permissions: [
          {
            enabled: role.permissionUserCreate,
            label: 'Create',
          },
          {
            enabled: role.permissionUserDelete,
            label: 'Delete',
          },
          {
            enabled: role.permissionUserEdit,
            label: 'Edit',
          },
          {
            enabled: role.permissionUserView,
            label: 'View',
          },
        ],
      },
    ];
  });
}
