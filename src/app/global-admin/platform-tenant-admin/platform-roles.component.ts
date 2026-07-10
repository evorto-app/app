import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Injectable,
  input,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatSelectModule } from '@angular/material/select';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import type { PlatformRoleRecord } from '../../../shared/rpc-contracts/app-rpcs/platform-tenant-admin.rpcs';

import {
  type Permission,
  PERMISSION_GROUPS,
} from '../../../shared/permissions/permissions';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from './platform-tenant-page-header.component';

interface PlatformRoleFormModel {
  collapseMembersInHup: boolean;
  defaultOrganizerRole: boolean;
  defaultUserRole: boolean;
  description: string;
  displayInHub: boolean;
  name: string;
  permissions: Permission[];
  reason: string;
}

const emptyRole = (): PlatformRoleFormModel => ({
  collapseMembersInHup: false,
  defaultOrganizerRole: false,
  defaultUserRole: false,
  description: '',
  displayInHub: false,
  name: '',
  permissions: [],
  reason: '',
});

@Injectable({ providedIn: 'root' })
export class PlatformRolesOperations {
  private readonly rpc = AppRpc.injectClient();

  create() {
    return this.rpc.platform.roles.create.mutationOptions();
  }

  delete() {
    return this.rpc.platform.roles.delete.mutationOptions();
  }

  list(targetTenantId: string) {
    return this.rpc.platform.roles.list.queryOptions({ targetTenantId });
  }

  rolesFilter() {
    return this.rpc.queryFilter(['platform', 'roles']);
  }

  update() {
    return this.rpc.platform.roles.update.mutationOptions();
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatListModule,
    MatSelectModule,
    PlatformTenantPageHeaderComponent,
  ],
  selector: 'app-platform-roles',
  templateUrl: './platform-roles.component.html',
})
export class PlatformRolesComponent {
  readonly tenantId = input.required<string>();

  private readonly operations = inject(PlatformRolesOperations);
  protected readonly createMutation = injectMutation(() =>
    this.operations.create(),
  );
  protected readonly deleteConfirmation = signal(false);
  protected readonly deleteMutation = injectMutation(() =>
    this.operations.delete(),
  );
  protected readonly permissionGroups = PERMISSION_GROUPS;

  private readonly roleModel = signal<PlatformRoleFormModel>(emptyRole());
  protected readonly roleForm = form(this.roleModel, (role) => {
    required(role.name, { message: 'Enter a role name.' });
    maxLength(role.name, 100, {
      message: 'Name must be 100 characters or fewer.',
    });
    maxLength(role.description, 500, {
      message: 'Description must be 500 characters or fewer.',
    });
    required(role.reason, { message: 'Enter an operational reason.' });
    maxLength(role.reason, 500, {
      message: 'Reason must be 500 characters or fewer.',
    });
  });
  protected readonly rolesQuery = injectQuery(() =>
    this.operations.list(this.tenantId()),
  );
  protected readonly selectedRoleId = signal<null | string>(null);
  protected readonly updateMutation = injectMutation(() =>
    this.operations.update(),
  );
  private readonly notifications = inject(NotificationService);

  private readonly queryClient = inject(QueryClient);
  protected cancelDelete(): void {
    this.deleteConfirmation.set(false);
  }

  protected createRole(): void {
    this.deleteConfirmation.set(false);
    this.selectedRoleId.set(null);
    this.roleModel.set(emptyRole());
    this.roleForm().reset();
  }

  protected deleteRole(): void {
    const roleId = this.selectedRoleId();
    const reason = this.roleModel().reason.trim();
    if (!roleId || !reason || this.mutationPending()) return;

    void (async () => {
      try {
        await this.deleteMutation.mutateAsync({
          reason,
          roleId,
          targetTenantId: this.tenantId(),
        });
        await this.refreshRoles();
        this.notifications.showSuccess('Role deleted');
        this.createRole();
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to delete role'),
        );
      }
    })();
  }

  protected editRole(role: PlatformRoleRecord): void {
    this.deleteConfirmation.set(false);
    this.selectedRoleId.set(role.id);
    this.roleModel.set({
      collapseMembersInHup: role.collapseMembersInHup,
      defaultOrganizerRole: role.defaultOrganizerRole,
      defaultUserRole: role.defaultUserRole,
      description: role.description ?? '',
      displayInHub: role.displayInHub,
      name: role.name,
      permissions: [...role.permissions],
      reason: '',
    });
    this.roleForm().reset();
  }

  protected readonly mutationPending = () =>
    this.createMutation.isPending() ||
    this.updateMutation.isPending() ||
    this.deleteMutation.isPending();

  protected requestDelete(): void {
    this.deleteConfirmation.set(true);
  }

  protected saveRole(event: Event): void {
    event.preventDefault();
    if (this.mutationPending()) return;

    void submit(this.roleForm, async () => {
      const role = this.roleModel();
      const roleId = this.selectedRoleId();
      const payload = {
        collapseMembersInHup: role.collapseMembersInHup,
        defaultOrganizerRole: role.defaultOrganizerRole,
        defaultUserRole: role.defaultUserRole,
        description: role.description.trim() || null,
        displayInHub: role.displayInHub,
        name: role.name,
        permissions: role.permissions,
        reason: role.reason,
        targetTenantId: this.tenantId(),
      };

      try {
        if (roleId) {
          await this.updateMutation.mutateAsync({ ...payload, roleId });
        } else {
          await this.createMutation.mutateAsync(payload);
        }
        await this.refreshRoles();
        this.notifications.showSuccess(
          roleId ? 'Role updated' : 'Role created',
        );
        this.createRole();
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            roleId ? 'Failed to update role' : 'Failed to create role',
          ),
        );
      }
    });
  }

  private async refreshRoles(): Promise<void> {
    await this.queryClient.invalidateQueries(this.operations.rolesFilter());
  }
}
