import { SelectionModel } from '@angular/cdk/collections';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatMenuModule } from '@angular/material/menu';
import { MatTableDataSource, MatTableModule } from '@angular/material/table';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faEdit,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatMenuModule,
    MatButtonModule,
    MatTableModule,
    MatCheckboxModule,
    MatChipsModule,
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
  protected readonly faEdit = faEdit;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly selection = new SelectionModel<{
    email: string;
    firstName: string;
    id: string;
    lastName: string;
    roles: string[];
  }>(true);
  private readonly queries = inject(QueriesService);
  protected readonly usersQuery = injectQuery(this.queries.users());
  protected readonly usersDataSource = new MatTableDataSource(
    this.usersQuery.data(),
  );

  constructor() {
    effect(() => {
      const users = this.usersQuery.data();
      if (users) {
        this.usersDataSource.data = users;
      }
    });
  }

  /** Whether the number of selected elements matches the total number of rows. */
  isAllSelected() {
    const numberSelected = this.selection.selected.length;
    const numberRows = this.usersDataSource.data.length;
    return numberSelected == numberRows;
  }

  /** Selects all rows if they are not all selected; otherwise clear selection. */
  toggleAllRows() {
    this.isAllSelected()
      ? this.selection.clear()
      : this.usersDataSource.data.forEach((row) => this.selection.select(row));
  }
}
