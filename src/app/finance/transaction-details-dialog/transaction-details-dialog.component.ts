import { CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

export interface TransactionDetailsData {
  amount: number;
  appFee?: null | number;
  comment?: null | string;
  createdAt: Date | string;
  currency?: string | null;
  eventId?: null | string;
  method: string;
  status: string;
  stripeChargeId?: null | string;
  stripeCheckoutUrl?: null | string;
  stripeFee?: null | number;
  stripePaymentIntentId?: null | string;
  targetUserId?: null | string;
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, CurrencyPipe, DatePipe],
  selector: 'app-transaction-details-dialog',
  template: `
    <div class="bg-surface text-on-surface w-full rounded-2xl p-6 shadow-2xl">
      <div class="flex items-center justify-between gap-4">
        <h2 class="title-medium">Transaction details</h2>
        <button mat-button type="button" (click)="close()">Close</button>
      </div>
      <div class="mt-4 grid gap-3 text-sm">
        <div class="flex items-center justify-between gap-4">
          <span class="text-on-surface-variant">Status</span>
          <span class="font-medium">{{ data().status }}</span>
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-on-surface-variant">Method</span>
          <span class="font-medium">{{ data().method }}</span>
        </div>
        <div class="flex items-center justify-between gap-4">
          <span class="text-on-surface-variant">Amount</span>
          <span class="font-medium">
            {{ data().amount / 100 | currency: data().currency ?? 'EUR' }}
          </span>
        </div>
        @if (data().appFee != null || data().stripeFee != null) {
          <div class="flex items-center justify-between gap-4">
            <span class="text-on-surface-variant">Fees</span>
            <span class="font-medium">
              {{
                ((data().appFee ?? 0) + (data().stripeFee ?? 0)) / 100
                  | currency: data().currency ?? 'EUR'
              }}
            </span>
          </div>
        }
        <div class="flex items-center justify-between gap-4">
          <span class="text-on-surface-variant">Created</span>
          <span class="font-medium">{{ data().createdAt | date: 'medium' }}</span>
        </div>
        @if (data().comment) {
          <div class="flex items-center justify-between gap-4">
            <span class="text-on-surface-variant">Comment</span>
            <span class="font-medium">{{ data().comment }}</span>
          </div>
        }
        @if (data().eventId) {
          <div class="flex items-center justify-between gap-4">
            <span class="text-on-surface-variant">Event</span>
            <span class="font-medium">{{ data().eventId }}</span>
          </div>
        }
        @if (data().targetUserId) {
          <div class="flex items-center justify-between gap-4">
            <span class="text-on-surface-variant">User</span>
            <span class="font-medium">{{ data().targetUserId }}</span>
          </div>
        }
        @if (data().stripeCheckoutUrl) {
          <div class="flex items-center justify-between gap-4">
            <span class="text-on-surface-variant">Checkout</span>
            <span class="font-medium">{{ data().stripeCheckoutUrl }}</span>
          </div>
        }
        @if (data().stripePaymentIntentId) {
          <div class="flex items-center justify-between gap-4">
            <span class="text-on-surface-variant">Payment intent</span>
            <span class="font-medium">{{ data().stripePaymentIntentId }}</span>
          </div>
        }
        @if (data().stripeChargeId) {
          <div class="flex items-center justify-between gap-4">
            <span class="text-on-surface-variant">Charge</span>
            <span class="font-medium">{{ data().stripeChargeId }}</span>
          </div>
        }
      </div>
    </div>
  `,
})
export class TransactionDetailsDialogComponent {
  readonly data = input.required<TransactionDetailsData>();
  readonly closeRequested = output<void>();

  close(): void {
    this.closeRequested.emit();
  }
}
