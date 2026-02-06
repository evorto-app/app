import { DatePipe, DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSelectModule } from '@angular/material/select';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { NotificationService } from '../../core/notification.service';
import { injectTRPC } from '../../core/trpc-client';

type PayoutType = 'iban' | 'paypal';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DecimalPipe, MatButtonModule, MatSelectModule],
  selector: 'app-receipt-refund-list',
  styles: ``,
  templateUrl: './receipt-refund-list.component.html',
})
export class ReceiptRefundListComponent {
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
  private readonly notifications = inject(NotificationService);

  private readonly payoutTypeByRecipient = signal<Record<string, PayoutType>>({});
  private readonly selectionByRecipient = signal<Record<string, Record<string, boolean>>>(
    {},
  );

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
    const current = this.payoutTypeByRecipient()[recipientId];
    if (current) {
      return current;
    }
    const next: PayoutType = payout.iban ? 'iban' : 'paypal';
    this.setPayoutType(recipientId, next);
    return next;
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
      const [firstReceiptId, ...otherReceiptIds] = receiptIds;
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

  protected selectedTotal(recipientId: string): number {
    const selectedIds = new Set(this.selectedReceiptIds(recipientId));
    const recipients = this.refundableReceiptsQuery.data() ?? [];
    const group = recipients.find((item) => item.submittedByUserId === recipientId);
    if (!group) {
      return 0;
    }
    return group.receipts
      .filter((receipt) => selectedIds.has(receipt.id))
      .reduce((sum, receipt) => sum + receipt.totalAmount, 0);
  }

  protected setPayoutType(recipientId: string, payoutType: PayoutType): void {
    this.payoutTypeByRecipient.update((current) => ({
      ...current,
      [recipientId]: payoutType,
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
