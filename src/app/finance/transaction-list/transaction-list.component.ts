import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import {
  FaDuotoneIconComponent,
  FaIconComponent,
} from '@fortawesome/angular-fontawesome';
import { faEllipsisVertical } from '@fortawesome/duotone-regular-svg-icons';
import { faPaypal, faStripe } from '@fortawesome/free-brands-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FaDuotoneIconComponent,
    MatButtonModule,
    MatMenuModule,
    MatTableModule,
    MatPaginatorModule,
    RouterLink,
    CurrencyPipe,
    FaIconComponent,
    DatePipe,
  ],
  selector: 'app-transaction-list',
  styles: ``,
  templateUrl: './transaction-list.component.html',
})
export class TransactionListComponent {
  protected readonly columnsToDisplay = signal([
    'created',
    'amount',
    'status',
    'method',
    'comment',
  ]);
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faPaypal = faPaypal;
  protected readonly faStripe = faStripe;

  private readonly filterInput = signal<{
    limit: number;
    offset: number;
    // search?: string;
  }>({
    limit: 100,
    offset: 0,
  });

  private readonly trpc = injectTRPC();

  protected readonly transactionsQuery = injectQuery(() =>
    this.trpc.finance.transactions.findMany.queryOptions(this.filterInput()),
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
