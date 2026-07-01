import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { PermissionsService } from '../../core/permissions.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTableModule,
    RouterLink,
  ],
  selector: 'app-user-list',
  styles: ``,
  templateUrl: './user-list.component.html',
})
export class UserListComponent {
  private readonly rpc = AppRpc.injectClient();
  protected readonly assignRolesMutation = injectMutation(() =>
    this.rpc.users.assignRoles.mutationOptions(),
  );
  private readonly permissions = inject(PermissionsService);
  protected readonly canAssignRoles =
    this.permissions.hasPermission('users:assignRoles');

  protected readonly columnsToDisplay = signal<string[]>([
    'name',
    'email',
    'role',
  ]);
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly pageIndex = signal(0);
  protected readonly roleOptionsQuery = injectQuery(() =>
    this.rpc.roles.findMany.queryOptions({}),
  );
  private readonly filterInput = signal<{
    limit?: number;
    offset?: number;
    search?: string;
  }>({});
  protected readonly usersQuery = injectQuery(() =>
    this.rpc.users.findMany.queryOptions(this.filterInput()),
  );

  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  handlePageChange(event: PageEvent) {
    this.pageIndex.set(event.pageIndex);
    this.filterInput.update((old) => ({
      ...old,
      limit: event.pageSize,
      offset: event.pageIndex * event.pageSize,
    }));
    consola.info('Page event', event);
  }

  protected handleSearchChange(value: string) {
    const search = value.trim();
    this.pageIndex.set(0);
    this.filterInput.update((old) => {
      const { search: _search, ...rest } = old;
      return search ? { ...rest, offset: 0, search } : { ...rest, offset: 0 };
    });
  }

  protected async updateUserRoles(
    userId: string,
    roleIds: readonly string[],
  ): Promise<void> {
    try {
      await this.assignRolesMutation.mutateAsync({
        roleIds: [...roleIds],
        userId,
      });
      await this.queryClient.invalidateQueries(
        this.rpc.queryFilter(['users', 'findMany']),
      );
      this.notifications.showSuccess('User roles updated');
    } catch (error) {
      this.notifications.showError(
        getErrorMessage(error, 'Failed to update user roles'),
      );
    }
  }
}
