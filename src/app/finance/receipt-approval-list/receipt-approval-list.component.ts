import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, DatePipe, DecimalPipe],
  selector: 'app-receipt-approval-list',
  styles: ``,
  templateUrl: './receipt-approval-list.component.html',
})
export class ReceiptApprovalListComponent {
  private readonly trpc = injectTRPC();

  protected readonly pendingReceiptsQuery = injectQuery(() =>
    this.trpc.finance.receipts.pendingApprovalGrouped.queryOptions(),
  );
}
