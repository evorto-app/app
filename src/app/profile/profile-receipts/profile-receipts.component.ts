import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import { ReceiptAmountPipe } from '../../finance/shared/receipt-amount.pipe';
import { receiptStatusLabel } from '../../finance/shared/receipt-status-label';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, ReceiptAmountPipe, TenantDatePipe],
  selector: 'app-profile-receipts',
  templateUrl: './profile-receipts.component.html',
})
export class ProfileReceiptsComponent {
  private readonly rpc = AppRpc.injectClient();
  protected readonly myReceiptsQuery = injectQuery(() =>
    this.rpc.finance.receipts.my.queryOptions(),
  );
  protected readonly receiptRetryPending = signal(false);
  protected readonly receiptStatusLabel = receiptStatusLabel;

  protected async retryReceipts(): Promise<void> {
    if (this.receiptRetryPending() || this.myReceiptsQuery.isFetching()) return;

    this.receiptRetryPending.set(true);
    try {
      await this.myReceiptsQuery.refetch();
    } finally {
      this.receiptRetryPending.set(false);
    }
  }
}
