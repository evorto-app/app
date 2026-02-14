import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { NonNullableFormBuilder } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  buildSelectableReceiptCountries,
  resolveReceiptCountrySettings,
} from '@shared/finance/receipt-countries';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { ReceiptFormFieldsComponent } from '../shared/receipt-form/receipt-form-fields.component';
import { createReceiptForm } from '../shared/receipt-form/receipt-form.model';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    ReceiptFormFieldsComponent,
    RouterLink,
  ],
  selector: 'app-receipt-approval-detail',
  styles: ``,
  templateUrl: './receipt-approval-detail.component.html',
})
export class ReceiptApprovalDetailComponent {
  private readonly config = inject(ConfigService);
  protected readonly selectableCountries = buildSelectableReceiptCountries(
    resolveReceiptCountrySettings(this.config.tenant.receiptSettings),
  );
  private readonly formBuilder = inject(NonNullableFormBuilder);
  protected readonly form = createReceiptForm(
    this.formBuilder,
    this.selectableCountries[0] ?? 'DE',
  );
  private readonly route = inject(ActivatedRoute);
  protected readonly receiptId = computed(
    () => this.route.snapshot.paramMap.get('receiptId') ?? '',
  );
  private readonly rpc = AppRpc.injectClient();
  protected readonly receiptQuery = injectQuery(() =>
    this.rpc.finance['receipts.findOneForApproval'].queryOptions({
      id: this.receiptId(),
    }),
  );
  protected readonly isImagePreview = computed(() => {
    const receipt = this.receiptQuery.data();
    if (!receipt?.previewImageUrl) {
      return false;
    }
    return receipt.attachmentMimeType.startsWith('image/');
  });
  protected readonly isPdfPreview = computed(() => {
    const receipt = this.receiptQuery.data();
    if (!receipt?.previewImageUrl) {
      return false;
    }
    return receipt.attachmentMimeType === 'application/pdf';
  });

  protected readonly rejectionReason = signal('');
  protected readonly reviewMutation = injectMutation(() =>
    this.rpc.finance['receipts.review'].mutationOptions(),
  );
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly safePdfPreviewUrl = computed<null | SafeResourceUrl>(
    () => {
      const receipt = this.receiptQuery.data();
      if (
        !receipt?.previewImageUrl ||
        receipt.attachmentMimeType !== 'application/pdf'
      ) {
        return null;
      }
      return this.sanitizer.bypassSecurityTrustResourceUrl(
        receipt.previewImageUrl,
      );
    },
  );

  private readonly notifications = inject(NotificationService);

  private readonly queryClient = inject(QueryClient);

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
        receiptDate: new Date(receipt.receiptDate),
        taxAmount: receipt.taxAmount / 100,
        totalAmount: receipt.totalAmount / 100,
      });
      this.rejectionReason.set(receipt.rejectionReason ?? '');
    });
  }

  protected approve(): Promise<void> {
    return this.review('approved');
  }

  protected reject(): Promise<void> {
    return this.review('rejected');
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
    if (!this.selectableCountries.includes(value.purchaseCountry)) {
      this.notifications.showError('Selected purchase country is not allowed');
      return;
    }

    const totalAmount = Math.round(value.totalAmount * 100);
    const taxAmount = Math.round(value.taxAmount * 100);
    const depositAmount = value.hasDeposit
      ? Math.round(value.depositAmount * 100)
      : 0;
    const alcoholAmount = value.hasAlcohol
      ? Math.round(value.alcoholAmount * 100)
      : 0;
    if (depositAmount + alcoholAmount > totalAmount) {
      this.notifications.showError(
        'Deposit and alcohol amounts cannot exceed total amount',
      );
      return;
    }

    const receiptDate = new Date(value.receiptDate);
    if (Number.isNaN(receiptDate.getTime())) {
      this.notifications.showError('Invalid receipt date');
      return;
    }

    try {
      await this.reviewMutation.mutateAsync(
        {
          alcoholAmount,
          depositAmount,
          hasAlcohol: value.hasAlcohol,
          hasDeposit: value.hasDeposit,
          id: this.receiptId(),
          purchaseCountry: value.purchaseCountry,
          receiptDate: receiptDate.toISOString(),
          rejectionReason:
            status === 'rejected'
              ? this.rejectionReason().trim() || null
              : null,
          status,
          taxAmount,
          totalAmount,
        },
        {
          onSuccess: async () => {
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter([
                'finance',
                'receipts.pendingApprovalGrouped',
              ]),
            );
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter([
                'finance',
                'receipts.refundableGroupedByRecipient',
              ]),
            );
            await this.queryClient.invalidateQueries({
              queryKey: this.rpc.finance[
                'receipts.findOneForApproval'
              ].queryKey({
                id: this.receiptId(),
              }),
            });
            await this.queryClient.invalidateQueries(
              this.rpc.queryFilter(['finance', 'receipts.byEvent']),
            );
          },
        },
      );
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
