import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { RouterLink } from '@angular/router';
import {
  FaDuotoneIconComponent,
  FaIconComponent,
} from '@fortawesome/angular-fontawesome';
import {
  faEllipsisVertical,
  faMoneyBillTransfer,
} from '@fortawesome/duotone-regular-svg-icons';
import { faCcPaypal, faStripe } from '@fortawesome/free-brands-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { AppRpc } from '../../core/effect-rpc-angular-client';

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
  protected readonly faCcPaypal = faCcPaypal;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faMoneyBillTransfer = faMoneyBillTransfer;
  protected readonly faStripe = faStripe;

  private readonly filterInput = signal<{
    limit: number;
    offset: number;
    // search?: string;
  }>({
    limit: 100,
    offset: 0,
  });

  private readonly rpc = AppRpc.injectClient();

  protected readonly transactionsQuery = injectQuery(() =>
    this.rpc.finance.transactions.findMany.queryOptions(this.filterInput()),
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
