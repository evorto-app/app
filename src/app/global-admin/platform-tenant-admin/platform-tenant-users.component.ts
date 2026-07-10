import {
  ChangeDetectionStrategy,
  Component,
  computed,
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
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  MatPaginatorModule,
  type PageEvent,
} from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { PlatformTenantPageHeaderComponent } from './platform-tenant-page-header.component';

interface PlatformRoleAssignmentModel {
  reason: string;
  roleIds: string[];
  userId: string;
}

@Injectable({ providedIn: 'root' })
export class PlatformTenantUsersOperations {
  private readonly rpc = AppRpc.injectClient();

  assignRoles() {
    return this.rpc.platform.tenantUsers.assignRoles.mutationOptions();
  }

  listRoles(targetTenantId: string) {
    return this.rpc.platform.roles.list.queryOptions({ targetTenantId });
  }

  listUsers(input: {
    limit: number;
    offset: number;
    search: string;
    targetTenantId: string;
  }) {
    return this.rpc.platform.tenantUsers.list.queryOptions({
      limit: input.limit,
      offset: input.offset,
      search: input.search || undefined,
      targetTenantId: input.targetTenantId,
    });
  }

  usersFilter() {
    return this.rpc.queryFilter(['platform', 'tenantUsers', 'list']);
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormField,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTableModule,
    PlatformTenantPageHeaderComponent,
  ],
  selector: 'app-platform-tenant-users',
  templateUrl: './platform-tenant-users.component.html',
})
export class PlatformTenantUsersComponent {
  readonly tenantId = input.required<string>();

  private readonly assignmentModel = signal<PlatformRoleAssignmentModel>({
    reason: '',
    roleIds: [],
    userId: '',
  });
  protected readonly assignmentForm = form(
    this.assignmentModel,
    (assignment) => {
      required(assignment.userId, { message: 'Select a user.' });
      required(assignment.reason, { message: 'Enter an operational reason.' });
      maxLength(assignment.reason, 500, {
        message: 'Reason must be 500 characters or fewer.',
      });
    },
  );
  private readonly operations = inject(PlatformTenantUsersOperations);
  protected readonly assignRolesMutation = injectMutation(() =>
    this.operations.assignRoles(),
  );
  protected readonly columns = ['name', 'email', 'roles', 'actions'];
  protected readonly pageIndex = signal(0);
  protected readonly pageSize = signal(100);
  protected readonly rolesQuery = injectQuery(() =>
    this.operations.listRoles(this.tenantId()),
  );

  protected readonly search = signal('');
  protected readonly usersQuery = injectQuery(() =>
    this.operations.listUsers({
      limit: this.pageSize(),
      offset: this.pageIndex() * this.pageSize(),
      search: this.search(),
      targetTenantId: this.tenantId(),
    }),
  );
  protected readonly selectedUser = computed(() => {
    if (!this.usersQuery.isSuccess()) return;
    const userId = this.assignmentModel().userId;
    return this.usersQuery.data().users.find((user) => user.id === userId);
  });

  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  protected cancelAssignment(): void {
    this.assignmentModel.set({ reason: '', roleIds: [], userId: '' });
    this.assignmentForm().reset();
  }

  protected changePage(event: PageEvent): void {
    this.pageIndex.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
  }

  protected saveAssignment(event: Event): void {
    event.preventDefault();
    if (this.assignRolesMutation.isPending()) return;

    void submit(this.assignmentForm, async () => {
      const assignment = this.assignmentModel();
      try {
        await this.assignRolesMutation.mutateAsync({
          reason: assignment.reason,
          roleIds: assignment.roleIds,
          targetTenantId: this.tenantId(),
          userId: assignment.userId,
        });
        await this.queryClient.invalidateQueries(this.operations.usersFilter());
        this.notifications.showSuccess('User roles updated');
        this.cancelAssignment();
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to update user roles'),
        );
      }
    });
  }

  protected selectUser(user: { id: string; roleIds: readonly string[] }): void {
    this.assignmentModel.set({
      reason: '',
      roleIds: [...user.roleIds],
      userId: user.id,
    });
  }

  protected updateSearch(value: string): void {
    this.pageIndex.set(0);
    this.search.set(value.trim());
  }
}
