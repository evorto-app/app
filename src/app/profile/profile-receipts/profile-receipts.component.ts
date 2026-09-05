import { ChangeDetectionStrategy, Component } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import { ReceiptAmountPipe } from '../../finance/shared/receipt-amount.pipe';
import { receiptStatusLabel } from '../../finance/shared/receipt-status-label';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReceiptAmountPipe, TenantDatePipe],
  selector: 'app-profile-receipts',
  templateUrl: './profile-receipts.component.html',
})
export class ProfileReceiptsComponent {
  private readonly rpc = AppRpc.injectClient();
  protected readonly myReceiptsQuery = injectQuery(() =>
    this.rpc.finance.receipts.my.queryOptions(),
  );
  protected readonly receiptStatusLabel = receiptStatusLabel;
}
