import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { AppRpc } from '../../core/effect-rpc-angular-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    MatTableModule,
    MatPaginatorModule,
    MatChipsModule,
    RouterLink,
  ],
  selector: 'app-user-list',
  styles: ``,
  templateUrl: './user-list.component.html',
})
export class UserListComponent {
  protected readonly columnsToDisplay = signal<string[]>([
    'name',
    'email',
    'role',
  ]);
  protected readonly faArrowLeft = faArrowLeft;
  private readonly filterInput = signal<{
    limit?: number;
    offset?: number;
    search?: string;
  }>({});
  private readonly rpc = AppRpc.injectClient();

  protected readonly usersQuery = injectQuery(() =>
    this.rpc.users.findMany.queryOptions(this.filterInput()),
  );

  handlePageChange(event: PageEvent) {
    this.filterInput.update((old) => ({
      ...old,
      limit: event.pageSize,
      offset: event.pageIndex * event.pageSize,
    }));
    consola.info('Page event', event);
  }
}
