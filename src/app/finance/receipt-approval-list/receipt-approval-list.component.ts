import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import { ReceiptAmountPipe } from '../shared/receipt-amount.pipe';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, TenantDatePipe, ReceiptAmountPipe],
  selector: 'app-receipt-approval-list',
  styles: ``,
  templateUrl: './receipt-approval-list.component.html',
})
export class ReceiptApprovalListComponent {
  private readonly rpc = AppRpc.injectClient();

  protected readonly pendingReceiptsQuery = injectQuery(() =>
    this.rpc.finance.receipts.pendingApprovalGrouped.queryOptions(),
  );
}
