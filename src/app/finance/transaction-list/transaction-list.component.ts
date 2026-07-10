import { CurrencyPipe, DatePipe } from '@angular/common';
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
import {
  FaDuotoneIconComponent,
  FaIconComponent,
} from '@fortawesome/angular-fontawesome';
import { faMoneyBillTransfer } from '@fortawesome/duotone-regular-svg-icons';
import { faCcPaypal, faStripe } from '@fortawesome/free-brands-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { AppRpc } from '../../core/effect-rpc-angular-client';

interface TransactionListFilter {
  readonly limit: number;
  readonly offset: number;
}

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
    FaDuotoneIconComponent,
    MatButtonModule,
    MatTableModule,
    MatPaginatorModule,
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
  protected readonly faMoneyBillTransfer = faMoneyBillTransfer;
  protected readonly faStripe = faStripe;

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
    consola.info('Page event', event);
  }
}
