import { DatePipe, DecimalPipe } from '@angular/common';
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
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { NotificationService } from '../../core/notification.service';
import { injectTRPC } from '../../core/trpc-client';
import { ReceiptPreviewDialogComponent } from '../shared/receipt-preview-dialog/receipt-preview-dialog.component';

type PayoutType = 'iban' | 'paypal';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    DecimalPipe,
    MatButtonModule,
    MatCheckboxModule,
    MatSelectModule,
    MatTableModule,
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
  private readonly trpc = injectTRPC();
  protected readonly refundableReceiptsQuery = injectQuery(() =>
    this.trpc.finance.receipts.refundableGroupedByRecipient.queryOptions(),
  );
  private readonly queryClient = inject(QueryClient);

  protected readonly refundMutation = injectMutation(() =>
    this.trpc.finance.receipts.createRefund.mutationOptions({
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.finance.receipts.refundableGroupedByRecipient.pathKey(),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.finance.receipts.pendingApprovalGrouped.pathKey(),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.finance.transactions.findMany.pathKey(),
        });
      },
    }),
  );
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  private readonly payoutTypeByRecipient = signal<Record<string, PayoutType>>({});
  private readonly selectionByRecipient = signal<Record<string, Record<string, boolean>>>(
    {},
  );

  constructor() {
    effect(() => {
      const groups = this.refundableReceiptsQuery.data() ?? [];
      if (groups.length === 0) {
        return;
      }

      this.payoutTypeByRecipient.update((current) => {
        let hasChanges = false;
        const next = { ...current };

        for (const group of groups) {
          if (next[group.submittedByUserId]) {
            continue;
          }
          next[group.submittedByUserId] = group.payout.iban ? 'iban' : 'paypal';
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
    payout: { iban: null | string; paypalEmail: null | string },
  ): boolean {
    if (this.selectedReceiptIds(recipientId).length === 0) {
      return false;
    }
    const payoutType = this.getPayoutType(recipientId, payout);
    return payoutType === 'iban' ? Boolean(payout.iban) : Boolean(payout.paypalEmail);
  }

  protected getPayoutType(
    recipientId: string,
    payout: { iban: null | string; paypalEmail: null | string },
  ): PayoutType {
    return this.payoutTypeByRecipient()[recipientId] ?? (payout.iban ? 'iban' : 'paypal');
  }

  protected hasPreviewUrl(receipt: { previewImageUrl: null | string }): boolean {
    return Boolean(receipt.previewImageUrl);
  }

  protected isPartiallySelected(
    recipientId: string,
    receiptIds: readonly string[],
  ): boolean {
    if (receiptIds.length === 0) {
      return false;
    }
    const selected = this.selectionByRecipient()[recipientId] ?? {};
    const selectedCount = receiptIds.filter((receiptId) => selected[receiptId]).length;
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
    if (!receipt.previewImageUrl) {
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
    payout: { iban: null | string; paypalEmail: null | string };
    submittedByUserId: string;
  }): Promise<void> {
    const receiptIds = this.selectedReceiptIds(group.submittedByUserId);
    if (receiptIds.length === 0) {
      this.notifications.showError('Select at least one receipt');
      return;
    }

    const payoutType = this.getPayoutType(group.submittedByUserId, group.payout);
    const payoutReference =
      payoutType === 'iban' ? group.payout.iban : group.payout.paypalEmail;
    if (!payoutReference) {
      this.notifications.showError('Selected payout detail is missing');
      return;
    }

    try {
      const firstReceiptId = receiptIds[0];
      if (!firstReceiptId) {
        this.notifications.showError('Select at least one receipt');
        return;
      }
      const otherReceiptIds = receiptIds.slice(1);
      await this.refundMutation.mutateAsync({
        payoutReference,
        payoutType,
        receiptIds: [firstReceiptId, ...otherReceiptIds],
      });
      this.notifications.showSuccess('Refund transaction created');
      this.selectionByRecipient.update((current) => ({
        ...current,
        [group.submittedByUserId]: {},
      }));
    } catch (error) {
      this.notifications.showError(
        error instanceof Error ? error.message : 'Failed to create refund',
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
    const selectedIds = new Set(this.selectedReceiptIds(recipientId));
    return receipts
      .filter((receipt) => selectedIds.has(receipt.id))
      .reduce((sum, receipt) => sum + receipt.totalAmount, 0);
  }

  protected setPayoutType(recipientId: string, payoutType: null | string): void {
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
    this.selectionByRecipient.update((current) => ({
      ...current,
      [recipientId]: Object.fromEntries(
        receiptIds.map((receiptId) => [receiptId, checked]),
      ),
    }));
  }

  protected toggleReceipt(
    recipientId: string,
    receiptId: string,
    checked: boolean,
  ): void {
    this.selectionByRecipient.update((current) => ({
      ...current,
      [recipientId]: {
        ...current[recipientId],
        [receiptId]: checked,
      },
    }));
  }
}
