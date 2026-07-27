import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { maximumFinanceReimbursementReceiptCount } from '@shared/finance/reimbursement';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import { ReceiptAmountPipe } from '../shared/receipt-amount.pipe';
import {
  isSafeReceiptPreviewUrl,
  ReceiptPreviewDialogComponent,
} from '../shared/receipt-preview-dialog/receipt-preview-dialog.component';
import {
  type ReimbursementConfirmationData,
  ReimbursementConfirmationDialogComponent,
} from '../shared/reimbursement-confirmation-dialog/reimbursement-confirmation-dialog.component';

export type ReceiptReimbursementPayoutType = 'iban' | 'paypal';
type ReceiptCurrency = 'AUD' | 'CZK' | 'EUR';

interface ReceiptReimbursementPayoutDetails {
  iban: null | string;
  paypalEmail: null | string;
}

export const receiptReimbursementManualNotice =
  'Recording a reimbursement creates the Evorto finance transaction only. Transfer the money manually through the selected payout method.';

export const receiptReimbursementMissingPayoutNotice =
  'This person has no payout details. Ask them to add an IBAN or PayPal address to their profile before recording a reimbursement.';

export function receiptReimbursementCanRecord(
  selectedReceiptIds: readonly string[],
  payout: ReceiptReimbursementPayoutDetails,
  payoutType: ReceiptReimbursementPayoutType,
): boolean {
  if (selectedReceiptIds.length === 0) {
    return false;
  }
  if (selectedReceiptIds.length > maximumFinanceReimbursementReceiptCount) {
    return false;
  }

  return payoutType === 'iban'
    ? Boolean(payout.iban)
    : Boolean(payout.paypalEmail);
}

export function receiptReimbursementHasPayoutDetails(
  payout: ReceiptReimbursementPayoutDetails,
): boolean {
  return Boolean(payout.iban || payout.paypalEmail);
}

export function receiptReimbursementPayoutDetailLabel(
  payoutType: ReceiptReimbursementPayoutType,
  payoutReference: null | string,
): string {
  const label = payoutType === 'iban' ? 'IBAN' : 'PayPal';
  return `${label}: ${payoutReference || 'not set'}`;
}

export function receiptReimbursementReceiptSelectionLabel(receipt: {
  attachmentFileName: string;
  eventTitle: string;
}): string {
  return `Select receipt ${receipt.attachmentFileName} for ${receipt.eventTitle}`;
}

export function receiptReimbursementRecordDisabled(input: {
  canRecord: boolean;
  mutationPending: boolean;
}): boolean {
  return !input.canRecord || input.mutationPending;
}

export function receiptReimbursementSelectAllLabel(group: {
  currency: ReceiptCurrency;
  submittedByFirstName: string;
  submittedByLastName: string;
}): string {
  return `Select all ${group.currency} receipts for ${group.submittedByFirstName} ${group.submittedByLastName}`;
}

export function receiptReimbursementSelectedTotal(
  receipts: readonly { id: string; totalAmount: number }[],
  selectedReceiptIds: readonly string[],
): number {
  const selectedIds = new Set(selectedReceiptIds);
  return receipts
    .filter((receipt) => selectedIds.has(receipt.id))
    .reduce((sum, receipt) => sum + receipt.totalAmount, 0);
}

export const receiptReimbursementGroupKey = (group: {
  currency: ReceiptCurrency;
  submittedByUserId: string;
}): string => `${group.submittedByUserId}:${group.currency}`;

export const receiptReimbursementConfirmationData = (input: {
  currency: ReceiptCurrency;
  payoutDestination: string;
  payoutType: ReceiptReimbursementPayoutType;
  receiptCount: number;
  recipientEmail: string;
  recipientFirstName: string;
  recipientLastName: string;
  totalAmount: number;
}): ReimbursementConfirmationData => ({
  currency: input.currency,
  payoutDestination: input.payoutDestination,
  payoutMethod: input.payoutType === 'paypal' ? 'PayPal' : 'Bank transfer',
  receiptCount: input.receiptCount,
  recipient:
    `${input.recipientFirstName} ${input.recipientLastName}`.trim() ||
    input.recipientEmail,
  totalAmount: input.totalAmount,
});

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TenantDatePipe,
    MatButtonModule,
    MatCheckboxModule,
    MatSelectModule,
    MatTableModule,
    ReceiptAmountPipe,
  ],
  selector: 'app-receipt-refund-list',
  styles: ``,
  templateUrl: './receipt-refund-list.component.html',
})
export class ReceiptRefundListComponent {
  protected readonly displayedColumns = [
    'select',
    'fileName',
    'event',
    'receiptDate',
    'totalAmount',
    'preview',
  ];
  protected readonly maximumFinanceReimbursementReceiptCount =
    maximumFinanceReimbursementReceiptCount;
  protected readonly receiptReimbursementHasPayoutDetails =
    receiptReimbursementHasPayoutDetails;
  protected readonly receiptReimbursementManualNotice =
    receiptReimbursementManualNotice;
  protected readonly receiptReimbursementMissingPayoutNotice =
    receiptReimbursementMissingPayoutNotice;
  protected readonly receiptReimbursementPayoutDetailLabel =
    receiptReimbursementPayoutDetailLabel;
  protected readonly receiptReimbursementReceiptSelectionLabel =
    receiptReimbursementReceiptSelectionLabel;
  protected readonly receiptReimbursementRecordDisabled =
    receiptReimbursementRecordDisabled;
  protected readonly receiptReimbursementSelectAllLabel =
    receiptReimbursementSelectAllLabel;
  private readonly rpc = AppRpc.injectClient();
  protected readonly refundableReceiptsQuery = injectQuery(() =>
    this.rpc.finance.receipts.refundableGroupedByRecipient.queryOptions(),
  );
  protected readonly refundMutation = injectMutation(() =>
    this.rpc.finance.receipts.createRefund.mutationOptions(),
  );

  protected readonly reimbursementGroupKey = receiptReimbursementGroupKey;
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  private readonly payoutTypeByRecipient = signal<
    Record<string, ReceiptReimbursementPayoutType>
  >({});
  private readonly queryClient = inject(QueryClient);

  private readonly selectionByRecipient = signal<
    Record<string, Record<string, boolean>>
  >({});

  constructor() {
    effect(() => {
      const groups = this.refundableReceiptsQuery.isSuccess()
        ? this.refundableReceiptsQuery.data()
        : [];
      if (groups.length === 0) {
        return;
      }

      this.payoutTypeByRecipient.update((current) => {
        let hasChanges = false;
        const next = { ...current };

        for (const group of groups) {
          const groupKey = receiptReimbursementGroupKey(group);
          if (next[groupKey]) {
            continue;
          }
          next[groupKey] = group.payout.iban ? 'iban' : 'paypal';
          hasChanges = true;
        }

        return hasChanges ? next : current;
      });
    });
  }

  protected areAllSelected(
    recipientId: string,
    receiptIds: readonly string[],
  ): boolean {
    if (receiptIds.length === 0) {
      return false;
    }
    const selected = this.selectionByRecipient()[recipientId] ?? {};
    return receiptIds.every((receiptId) => selected[receiptId]);
  }

  protected canRefund(
    recipientId: string,
    payout: ReceiptReimbursementPayoutDetails,
  ): boolean {
    return receiptReimbursementCanRecord(
      this.selectedReceiptIds(recipientId),
      payout,
      this.getPayoutType(recipientId, payout),
    );
  }

  protected getPayoutType(
    recipientId: string,
    payout: ReceiptReimbursementPayoutDetails,
  ): ReceiptReimbursementPayoutType {
    return (
      this.payoutTypeByRecipient()[recipientId] ??
      (payout.iban ? 'iban' : 'paypal')
    );
  }

  protected hasPreviewUrl(receipt: {
    previewImageUrl: null | string;
  }): boolean {
    return isSafeReceiptPreviewUrl(receipt.previewImageUrl);
  }

  protected isPartiallySelected(
    recipientId: string,
    receiptIds: readonly string[],
  ): boolean {
    if (receiptIds.length === 0) {
      return false;
    }
    const selected = this.selectionByRecipient()[recipientId] ?? {};
    const selectedCount = receiptIds.filter(
      (receiptId) => selected[receiptId],
    ).length;
    return selectedCount > 0 && selectedCount < receiptIds.length;
  }

  protected isReceiptSelected(recipientId: string, receiptId: string): boolean {
    const selected = this.selectionByRecipient()[recipientId] ?? {};
    return Boolean(selected[receiptId]);
  }

  protected openPreviewDialog(receipt: {
    attachmentFileName: string;
    attachmentMimeType: string;
    previewImageUrl: null | string;
  }): void {
    if (!isSafeReceiptPreviewUrl(receipt.previewImageUrl)) {
      this.notifications.showError('Preview is unavailable for this receipt');
      return;
    }

    this.dialog.open(ReceiptPreviewDialogComponent, {
      data: {
        attachmentFileName: receipt.attachmentFileName,
        mimeType: receipt.attachmentMimeType,
        previewUrl: receipt.previewImageUrl,
      },
      maxWidth: '95vw',
      width: '960px',
    });
  }

  protected receiptIds(receipts: readonly { id: string }[]): string[] {
    return receipts.map((receipt) => receipt.id);
  }

  protected async refundRecipient(group: {
    currency: ReceiptCurrency;
    payout: { iban: null | string; paypalEmail: null | string };
    receipts: readonly { id: string; totalAmount: number }[];
    submittedByEmail: string;
    submittedByFirstName: string;
    submittedByLastName: string;
    submittedByUserId: string;
  }): Promise<void> {
    const groupKey = receiptReimbursementGroupKey(group);
    const receiptIds = this.selectedReceiptIds(groupKey);
    const payoutType = this.getPayoutType(groupKey, group.payout);
    const payoutReference =
      payoutType === 'iban' ? group.payout.iban : group.payout.paypalEmail;
    if (
      receiptReimbursementRecordDisabled({
        canRecord: receiptReimbursementCanRecord(
          receiptIds,
          group.payout,
          payoutType,
        ),
        mutationPending: this.refundMutation.isPending(),
      })
    ) {
      if (receiptIds.length === 0) {
        this.notifications.showError('Select at least one receipt');
        return;
      }
      if (this.refundMutation.isPending()) {
        return;
      }

      this.notifications.showError('Selected payout detail is missing');
      return;
    }
    if (!payoutReference) {
      this.notifications.showError('Selected payout detail is missing');
      return;
    }

    const confirmed = await firstValueFrom(
      this.dialog
        .open<
          ReimbursementConfirmationDialogComponent,
          ReimbursementConfirmationData,
          boolean
        >(ReimbursementConfirmationDialogComponent, {
          data: receiptReimbursementConfirmationData({
            currency: group.currency,
            payoutDestination: payoutReference,
            payoutType,
            receiptCount: receiptIds.length,
            recipientEmail: group.submittedByEmail,
            recipientFirstName: group.submittedByFirstName,
            recipientLastName: group.submittedByLastName,
            totalAmount: receiptReimbursementSelectedTotal(
              group.receipts,
              receiptIds,
            ),
          }),
          width: 'min(38rem, calc(100vw - 2rem))',
        })
        .afterClosed(),
    );
    if (confirmed !== true || this.refundMutation.isPending()) {
      return;
    }

    try {
      const firstReceiptId = receiptIds[0];
      if (!firstReceiptId) {
        this.notifications.showError('Select at least one receipt');
        return;
      }
      const otherReceiptIds = receiptIds.slice(1);
      await this.refundMutation.mutateAsync(
        {
          payoutReference,
          payoutType,
          receiptIds: [firstReceiptId, ...otherReceiptIds],
        },
        {
          onSuccess: async () => {
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter([
                'finance',
                'receipts.refundableGroupedByRecipient',
              ]),
            );
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter([
                'finance',
                'receipts.pendingApprovalGrouped',
              ]),
            );
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['finance', 'transactions.findMany']),
            );
          },
        },
      );
      this.notifications.showSuccess('Reimbursement transaction recorded');
      this.selectionByRecipient.update((current) => ({
        ...current,
        [groupKey]: {},
      }));
    } catch (error) {
      this.notifications.showError(
        getErrorMessage(error, 'Failed to record reimbursement'),
      );
    }
  }

  protected selectedReceiptIds(recipientId: string): string[] {
    const selected = this.selectionByRecipient()[recipientId] ?? {};
    return Object.entries(selected)
      .filter(([, checked]) => checked)
      .map(([receiptId]) => receiptId);
  }

  protected selectedTotal(
    recipientId: string,
    receipts: readonly { id: string; totalAmount: number }[],
  ): number {
    return receiptReimbursementSelectedTotal(
      receipts,
      this.selectedReceiptIds(recipientId),
    );
  }

  protected setPayoutType(
    recipientId: string,
    payoutType: null | string,
  ): void {
    if (payoutType !== 'iban' && payoutType !== 'paypal') {
      return;
    }
    this.payoutTypeByRecipient.update((current) => ({
      ...current,
      [recipientId]: payoutType,
    }));
  }

  protected toggleAllReceipts(
    recipientId: string,
    receiptIds: readonly string[],
    checked: boolean,
  ): void {
    const boundedReceiptIds = receiptIds.slice(
      0,
      maximumFinanceReimbursementReceiptCount,
    );
    this.selectionByRecipient.update((current) => ({
      ...current,
      [recipientId]: Object.fromEntries(
        boundedReceiptIds.map((receiptId) => [receiptId, checked]),
      ),
    }));
  }

  protected toggleReceipt(
    recipientId: string,
    receiptId: string,
    checked: boolean,
  ): void {
    if (
      checked &&
      !this.isReceiptSelected(recipientId, receiptId) &&
      this.selectedReceiptIds(recipientId).length >=
        maximumFinanceReimbursementReceiptCount
    ) {
      this.notifications.showError(
        `Select at most ${maximumFinanceReimbursementReceiptCount} receipts per reimbursement`,
      );
      return;
    }
    this.selectionByRecipient.update((current) => ({
      ...current,
      [recipientId]: {
        ...current[recipientId],
        [receiptId]: checked,
      },
    }));
  }
}
