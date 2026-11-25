import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import { ReceiptAmountPipe } from '../../finance/shared/receipt-amount.pipe';
import { receiptStatusLabel } from '../../finance/shared/receipt-status-label';

export const receiptAmountChanged = (receipt: {
  status: 'approved' | 'refunded' | 'rejected' | 'submitted';
  submittedTotalAmount: null | number;
  totalAmount: number;
}): boolean =>
  (receipt.status === 'approved' || receipt.status === 'refunded') &&
  receipt.submittedTotalAmount !== null &&
  receipt.submittedTotalAmount !== receipt.totalAmount;

export const receiptReviewerName = (receipt: {
  reviewedByFirstName: null | string;
  reviewedByLastName: null | string;
}): null | string => {
  const name = [receipt.reviewedByFirstName, receipt.reviewedByLastName]
    .map((part) => part?.trim() ?? '')
    .filter((part) => part.length > 0)
    .join(' ');
  return name.length > 0 ? name : null;
};

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
  protected readonly receiptAmountChanged = receiptAmountChanged;
  protected readonly receiptReviewerName = receiptReviewerName;
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
