import { SelectionModel } from '@angular/cdk/collections';
import {
  ChangeDetectionStrategy,
  Component,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEdit,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatMenuModule,
    MatButtonModule,
    MatTableModule,
    MatPaginatorModule,
    MatCheckboxModule,
    MatChipsModule,
    RouterLink,
  ],
  selector: 'app-user-list',
  styles: ``,
  templateUrl: './user-list.component.html',
})
export class UserListComponent {
  protected readonly columnsToDisplay = signal<string[]>([
    'select',
    'name',
    'email',
    'role',
    'actions',
  ]);
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEdit = faEdit;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly selection = new SelectionModel<{
    email: string;
    firstName: string;
    id: string;
    lastName: string;
    roles: string[];
  }>(true);
  private readonly filterInput = signal<{
    limit?: number;
    offset?: number;
    search?: string;
  }>({});
  private readonly trpc = injectTRPC();

  protected readonly usersQuery = injectQuery(() =>
    this.trpc.users.findMany.queryOptions(this.filterInput()),
  );

  handlePageChange(event: PageEvent) {
    this.filterInput.update((old) => ({
      ...old,
      limit: event.pageSize,
      offset: event.pageIndex * event.pageSize,
    }));
    consola.info('Page event', event);
  }

  /** Whether the number of selected elements matches the total number of rows. */
  isAllSelected() {
    const numberSelected = this.selection.selected.length;
    const numberRows = this.usersQuery.data()?.users?.length ?? 0;
    return numberSelected == numberRows;
  }

  /** Selects all rows if they are not all selected; otherwise clear selection. */
  toggleAllRows() {
    this.isAllSelected()
      ? this.selection.clear()
      : this.usersQuery
          .data()
          ?.users?.forEach((row) => this.selection.select(row));
  }
}
