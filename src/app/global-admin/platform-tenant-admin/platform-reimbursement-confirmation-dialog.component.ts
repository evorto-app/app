import type { PlatformFinanceReimbursementGroup } from '@shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';

import { CurrencyPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';

export interface PlatformReimbursementConfirmationData {
  readonly currency: PlatformFinanceReimbursementGroup['currency'];
  readonly payoutDestination: string;
  readonly payoutMethod: 'Bank transfer' | 'PayPal';
  readonly receiptCount: number;
  readonly recipient: string;
  readonly totalAmount: number;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    MatButtonModule,
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogTitle,
  ],
  selector: 'app-platform-reimbursement-confirmation-dialog',
  template: `
    <h2 mat-dialog-title>Record reimbursement?</h2>
    <mat-dialog-content class="grid gap-5">
      <p class="body-medium">
        Review the completed payout before recording it. Evorto does not send
        the money.
      </p>

      <dl class="grid gap-3 sm:grid-cols-2">
        <div>
          <dt class="label-medium text-on-surface-variant">Recipient</dt>
          <dd class="body-medium">{{ data.recipient }}</dd>
        </div>
        <div>
          <dt class="label-medium text-on-surface-variant">Receipts</dt>
          <dd class="body-medium">{{ data.receiptCount }}</dd>
        </div>
        <div class="sm:col-span-2">
          <dt class="label-medium text-on-surface-variant">
            Payout destination
          </dt>
          <dd class="body-medium break-all">
            {{ data.payoutMethod }} · {{ data.payoutDestination }}
          </dd>
        </div>
        <div>
          <dt class="label-medium text-on-surface-variant">Currency</dt>
          <dd class="body-medium">{{ data.currency }}</dd>
        </div>
        <div>
          <dt class="label-medium text-on-surface-variant">Total</dt>
          <dd class="body-medium">
            {{ data.totalAmount / 100 | currency: data.currency }}
          </dd>
        </div>
      </dl>

      <p class="body-medium bg-surface-container p-4">
        Confirm only after paying the recipient outside Evorto. Recording this
        reimbursement marks the selected receipts as reimbursed and cannot be
        undone.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button
        mat-button
        type="button"
        [mat-dialog-close]="false"
        cdkFocusInitial
      >
        Go back
      </button>
      <button mat-flat-button type="button" [mat-dialog-close]="true">
        Record reimbursement
      </button>
    </mat-dialog-actions>
  `,
})
export class PlatformReimbursementConfirmationDialogComponent {
  protected readonly data =
    inject<PlatformReimbursementConfirmationData>(MAT_DIALOG_DATA);
}
