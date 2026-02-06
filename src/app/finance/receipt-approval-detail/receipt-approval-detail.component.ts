import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import {
  FormBuilder,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { NotificationService } from '../../core/notification.service';
import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    ReactiveFormsModule,
    RouterLink,
  ],
  selector: 'app-receipt-approval-detail',
  styles: ``,
  templateUrl: './receipt-approval-detail.component.html',
})
export class ReceiptApprovalDetailComponent {
  private readonly formBuilder = inject(FormBuilder).nonNullable;
  protected readonly form = this.formBuilder.group({
    alcoholAmount: this.formBuilder.control(0, {
      validators: [Validators.min(0)],
    }),
    depositAmount: this.formBuilder.control(0, {
      validators: [Validators.min(0)],
    }),
    hasAlcohol: this.formBuilder.control(false),
    hasDeposit: this.formBuilder.control(false),
    purchaseCountry: this.formBuilder.control('', {
      validators: [Validators.required],
    }),
    receiptDate: this.formBuilder.control('', {
      validators: [Validators.required],
    }),
    stripeTaxRateId: this.formBuilder.control('', {
      validators: [Validators.required],
    }),
    totalAmount: this.formBuilder.control(0, {
      validators: [Validators.min(0)],
    }),
  });
  private readonly route = inject(ActivatedRoute);
  protected readonly receiptId = computed(
    () => this.route.snapshot.paramMap.get('receiptId') ?? '',
  );
  private readonly trpc = injectTRPC();
  protected readonly receiptQuery = injectQuery(() =>
    this.trpc.finance.receipts.findOneForApproval.queryOptions({
      id: this.receiptId(),
    }),
  );

  protected readonly rejectionReason = signal('');
  private readonly queryClient = inject(QueryClient);

  protected readonly reviewMutation = injectMutation(() =>
    this.trpc.finance.receipts.review.mutationOptions({
      onSuccess: async () => {
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.finance.receipts.pendingApprovalGrouped.pathKey(),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.finance.receipts.refundableGroupedByRecipient.pathKey(),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.finance.receipts.findOneForApproval.queryKey({
            id: this.receiptId(),
          }),
        });
        await this.queryClient.invalidateQueries({
          queryKey: this.trpc.finance.receipts.byEvent.pathKey(),
        });
      },
    }),
  );
  protected readonly taxRatesQuery = injectQuery(() =>
    this.trpc.taxRates.listActive.queryOptions(),
  );
  private readonly notifications = inject(NotificationService);

  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const receipt = this.receiptQuery.data();
      if (!receipt) {
        return;
      }

      this.form.patchValue({
        alcoholAmount: receipt.alcoholAmount / 100,
        depositAmount: receipt.depositAmount / 100,
        hasAlcohol: receipt.hasAlcohol,
        hasDeposit: receipt.hasDeposit,
        purchaseCountry: receipt.purchaseCountry,
        receiptDate: receipt.receiptDate.toISOString().slice(0, 10),
        stripeTaxRateId: receipt.stripeTaxRateId,
        totalAmount: receipt.totalAmount / 100,
      });
      this.rejectionReason.set(receipt.rejectionReason ?? '');
    });
  }

  protected async approve(): Promise<void> {
    await this.review('approved');
  }

  protected async reject(): Promise<void> {
    await this.review('rejected');
  }

  protected updateRejectionReason(value: string): void {
    this.rejectionReason.set(value);
  }

  private async review(status: 'approved' | 'rejected'): Promise<void> {
    if (this.form.invalid || this.receiptQuery.isPending()) {
      this.form.markAllAsTouched();
      return;
    }

    const value = this.form.getRawValue();
    const totalAmount = Math.round(value.totalAmount * 100);
    const depositAmount = value.hasDeposit ? Math.round(value.depositAmount * 100) : 0;
    const alcoholAmount = value.hasAlcohol ? Math.round(value.alcoholAmount * 100) : 0;
    if (depositAmount + alcoholAmount > totalAmount) {
      this.notifications.showError(
        'Deposit and alcohol amounts cannot exceed total amount',
      );
      return;
    }

    const receiptDate = new Date(`${value.receiptDate}T12:00:00.000Z`);
    if (Number.isNaN(receiptDate.getTime())) {
      this.notifications.showError('Invalid receipt date');
      return;
    }

    try {
      await this.reviewMutation.mutateAsync({
        alcoholAmount,
        depositAmount,
        hasAlcohol: value.hasAlcohol,
        hasDeposit: value.hasDeposit,
        id: this.receiptId(),
        purchaseCountry: value.purchaseCountry.trim(),
        receiptDate,
        rejectionReason:
          status === 'rejected' ? this.rejectionReason().trim() || null : null,
        status,
        stripeTaxRateId: value.stripeTaxRateId,
        totalAmount,
      });
      this.notifications.showSuccess(
        status === 'approved' ? 'Receipt approved' : 'Receipt rejected',
      );
      await this.router.navigate(['/finance/receipts-approval']);
    } catch (error) {
      this.notifications.showError(
        error instanceof Error ? error.message : 'Failed to review receipt',
      );
    }
  }
}
