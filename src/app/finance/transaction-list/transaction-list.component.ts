import type { FinanceTransactionRecord } from '@shared/rpc-contracts/app-rpcs/finance.rpcs';

import { CurrencyPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  Injectable,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatTableModule } from '@angular/material/table';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { TenantDatePipe } from '../../core/tenant-date.pipe';

interface TransactionListFilter {
  readonly limit: number;
  readonly offset: number;
}

export const transactionMethodLabel = {
  cash: 'Cash',
  paypal: 'PayPal',
  stripe: 'Stripe',
  transfer: 'Bank transfer',
} as const satisfies Record<FinanceTransactionRecord['method'], string>;

export const transactionStatusLabel = {
  cancelled: 'Cancelled',
  pending: 'Pending',
  successful: 'Completed',
} as const satisfies Record<FinanceTransactionRecord['status'], string>;

@Injectable({ providedIn: 'root' })
export class TransactionListQueries {
  private readonly rpc = AppRpc.injectClient();

  findMany(filter: TransactionListFilter) {
    return this.rpc.finance.transactions.findMany.queryOptions(filter);
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatTableModule,
    MatPaginatorModule,
    CurrencyPipe,
    TenantDatePipe,
  ],
  selector: 'app-transaction-list',
  templateUrl: './transaction-list.component.html',
})
export class TransactionListComponent {
  protected readonly columnsToDisplay = [
    'created',
    'amount',
    'status',
    'method',
    'comment',
  ];
  private readonly filterInput = signal<TransactionListFilter>({
    limit: 100,
    offset: 0,
  });
  private readonly queries = inject(TransactionListQueries);

  protected readonly transactionsQuery = injectQuery(() =>
    this.queries.findMany(this.filterInput()),
  );

  handlePageChange(event: PageEvent) {
    this.filterInput.update((old) => ({
      ...old,
      limit: event.pageSize,
      offset: event.pageIndex * event.pageSize,
    }));
  }

  protected readonly methodLabel = (
    method: FinanceTransactionRecord['method'],
  ): string => transactionMethodLabel[method];

  protected readonly statusLabel = (
    status: FinanceTransactionRecord['status'],
  ): string => transactionStatusLabel[status];
}
