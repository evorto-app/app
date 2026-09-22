import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  buildSelectableReceiptCountries,
  firstReceiptCountry,
  resolveReceiptCountrySettings,
} from '@shared/finance/receipt-countries';
import {
  isFinanceReceiptCalendarDate,
  validateFinanceReceiptAmounts,
} from '@shared/finance/receipt-values';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { ConfigService } from '../../core/config.service';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { majorCurrencyInputToMinorUnits } from '../../shared/components/controls/currency-amount-input/currency-amount-input.component';
import { ReceiptFormFieldsComponent } from '../shared/receipt-form/receipt-form-fields.component';
import { createReceiptForm } from '../shared/receipt-form/receipt-form.model';
import { isSafeReceiptPreviewUrl } from '../shared/receipt-preview-dialog/receipt-preview-dialog.component';

export const receiptReviewSuccessMessage = (
  status: 'approved' | 'rejected',
): string =>
  status === 'approved'
    ? 'Receipt approved. Evorto will now try to email the submitter.'
    : 'Receipt rejected. Evorto will now try to email the submitter.';

export const receiptReviewNotificationNotice =
  'Saving this decision asks Evorto to email the submitter. Delivery may take time or fail.';

export const receiptEvidenceUnavailableNotice =
  'The uploaded receipt file is unavailable. You cannot approve the receipt until the file can be checked, but you can still reject it.';

export const receiptReviewCountries = (
  configuredCountries: readonly string[],
  recordedCountry: string | undefined,
): readonly string[] =>
  recordedCountry && !configuredCountries.includes(recordedCountry)
    ? [...configuredCountries, recordedCountry]
    : configuredCountries;

export const receiptReviewActionDisabled = ({
  formInvalid,
  mutationPending,
  receiptPending,
}: {
  formInvalid: boolean;
  mutationPending: boolean;
  receiptPending: boolean;
}): boolean => formInvalid || receiptPending || mutationPending;

export const receiptApprovalDisabled = ({
  evidenceAvailable,
  ...reviewState
}: {
  evidenceAvailable: boolean;
  formInvalid: boolean;
  mutationPending: boolean;
  receiptPending: boolean;
}): boolean => !evidenceAvailable || receiptReviewActionDisabled(reviewState);

export const receiptRejectionDisabled = ({
  rejectionReason,
  ...reviewState
}: {
  formInvalid: boolean;
  mutationPending: boolean;
  receiptPending: boolean;
  rejectionReason: string;
}): boolean =>
  rejectionReason.trim().length === 0 ||
  receiptReviewActionDisabled(reviewState);

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
  private readonly configuredCountries = buildSelectableReceiptCountries(
    resolveReceiptCountrySettings(this.config.tenant.receiptSettings),
  );
  private readonly formBuilder = inject(NonNullableFormBuilder);
  protected readonly form = createReceiptForm(
    this.formBuilder,
    firstReceiptCountry(this.configuredCountries),
  );
  private readonly route = inject(ActivatedRoute);
  private readonly routeParameters = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });
  protected readonly receiptId = computed(
    () => this.routeParameters().get('receiptId') ?? '',
  );
  private readonly rpc = AppRpc.injectClient();
  protected readonly receiptQuery = injectQuery(() =>
    this.rpc.finance.receipts.findOneForApproval.queryOptions({
      id: this.receiptId(),
    }),
  );
  protected readonly receiptPreviewUrl = computed(() => {
    const previewUrl = this.receiptQuery.data()?.previewImageUrl ?? null;
    return isSafeReceiptPreviewUrl(previewUrl) ? previewUrl : null;
  });
  protected readonly isImagePreview = computed(() => {
    const receipt = this.receiptQuery.data();
    if (!receipt || !this.receiptPreviewUrl()) {
      return false;
    }
    return receipt.attachmentMimeType.startsWith('image/');
  });
  protected readonly isPdfPreview = computed(() => {
    const receipt = this.receiptQuery.data();
    if (!receipt || !this.receiptPreviewUrl()) {
      return false;
    }
    return receipt.attachmentMimeType === 'application/pdf';
  });
  protected readonly receiptApprovalDisabled = receiptApprovalDisabled;
  protected readonly receiptEvidenceUnavailableNotice =
    receiptEvidenceUnavailableNotice;
  protected readonly receiptRejectionDisabled = receiptRejectionDisabled;
  protected readonly receiptReviewNotificationNotice =
    receiptReviewNotificationNotice;
  protected readonly rejectionReason = signal('');
  protected readonly reviewPhase = signal<
    'idle' | 'navigating' | 'refreshing' | 'saved' | 'saving' | 'unknown'
  >('idle');

  protected readonly reviewLocked = computed(
    () => this.reviewPhase() !== 'idle',
  );
  protected readonly reviewMessage = signal<null | string>(null);
  protected readonly reviewMutation = injectMutation(() => ({
    ...this.rpc.finance.receipts.review.mutationOptions(),
    retry: false,
  }));
  protected readonly reviewPending = computed(() =>
    ['navigating', 'refreshing', 'saving'].includes(this.reviewPhase()),
  );
  private readonly sanitizer = inject(DomSanitizer);
  protected readonly safePdfPreviewUrl = computed<null | SafeResourceUrl>(
    () => {
      const receipt = this.receiptQuery.data();
      if (
        !receipt ||
        !this.receiptPreviewUrl() ||
        receipt.attachmentMimeType !== 'application/pdf'
      ) {
        return null;
      }
      const previewUrl = this.receiptPreviewUrl();
      if (!previewUrl) {
        return null;
      }
      return this.sanitizer.bypassSecurityTrustResourceUrl(previewUrl);
    },
  );
  protected readonly selectableCountries = computed(() =>
    receiptReviewCountries(
      this.configuredCountries,
      this.receiptQuery.data()?.purchaseCountry,
    ),
  );
  private currentReceiptId: null | string = null;

  private readonly destroyRef = inject(DestroyRef);

  private initializedReceiptId: null | string = null;

  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private reviewIdentityVersion = 0;
  private readonly router = inject(Router);

  constructor() {
    effect(() => {
      const receiptId = this.receiptId();
      if (this.currentReceiptId !== receiptId) {
        this.currentReceiptId = receiptId;
        this.reviewIdentityVersion += 1;
        this.initializedReceiptId = null;
        this.reviewPhase.set('idle');
        this.reviewMessage.set(null);
      }
      const receipt = this.receiptQuery.data();
      if (
        !receipt ||
        receipt.id !== receiptId ||
        this.initializedReceiptId === receiptId
      ) {
        return;
      }
      this.initializedReceiptId = receiptId;

      this.form.patchValue({
        alcoholAmount: receipt.alcoholAmount / 100,
        depositAmount: receipt.depositAmount / 100,
        hasAlcohol: receipt.hasAlcohol,
        hasDeposit: receipt.hasDeposit,
        purchaseCountry: receipt.purchaseCountry,
        receiptDate: receipt.receiptDate,
        taxAmount: receipt.taxAmount / 100,
        totalAmount: receipt.totalAmount / 100,
      });
      this.rejectionReason.set(receipt.rejectionReason ?? '');
    });
    effect(() => {
      if (this.reviewLocked()) this.form.disable({ emitEvent: false });
      else this.form.enable({ emitEvent: false });
    });
  }

  protected approve(): Promise<void> {
    return this.review('approved');
  }

  protected reject(): Promise<void> {
    return this.review('rejected');
  }

  protected updateRejectionReason(value: string): void {
    if (this.reviewLocked()) return;
    this.rejectionReason.set(value);
  }

  private async refreshReviewLists(): Promise<void> {
    const filters = [
      this.rpc.queryFilter(['finance', 'receipts', 'pendingApprovalGrouped']),
      this.rpc.queryFilter([
        'finance',
        'receipts',
        'refundableGroupedByRecipient',
      ]),
      this.rpc.queryFilter(['finance', 'receipts', 'byEvent']),
    ];
    const reads = filters.map(async (filter) => {
      const invalidation = this.queryClient.invalidateQueries(filter, {
        throwOnError: true,
      });
      const activeQueries = this.queryClient
        .getQueryCache()
        .findAll({ ...filter, type: 'active' })
        .filter((query) => !query.isDisabled() && !query.isStatic());
      const results = await Promise.allSettled([
        invalidation,
        ...activeQueries
          .filter((query) => query.state.fetchStatus === 'fetching')
          .map((query) => query.promise),
      ]);
      const failures: unknown[] = [];
      for (const result of results) {
        if (result.status === 'rejected') failures.push(result.reason);
      }
      if (failures.length > 0)
        throw new AggregateError(
          failures,
          'Receipt review follow-up reads failed',
        );
      if (
        activeQueries.some(
          (query) =>
            query.state.status !== 'success' ||
            query.state.fetchStatus !== 'idle' ||
            query.state.isInvalidated,
        )
      ) {
        throw new Error('Receipt review follow-up reads did not complete');
      }
    });
    const results = await Promise.allSettled(reads);
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Receipt review follow-up reads failed',
      );
  }

  private async review(status: 'approved' | 'rejected'): Promise<void> {
    if (this.reviewLocked() || this.reviewMutation.isPending()) return;
    const receiptId = this.receiptId();
    if (this.initializedReceiptId !== receiptId) return;
    this.reviewMessage.set(null);
    const identityVersion = this.reviewIdentityVersion;
    const sameReceipt = () =>
      this.receiptId() === receiptId &&
      this.reviewIdentityVersion === identityVersion;
    const stillCurrent = () => !this.destroyRef.destroyed && sameReceipt();
    const formInvalid = this.form.invalid;
    const reviewState = {
      formInvalid,
      mutationPending: this.reviewMutation.isPending(),
      receiptPending: this.receiptQuery.isPending(),
    };
    const evidenceAvailable =
      this.receiptQuery.data()?.receiptEvidenceAvailable ?? false;
    const rejectionReason = this.rejectionReason().trim();
    const actionDisabled =
      status === 'approved'
        ? receiptApprovalDisabled({ evidenceAvailable, ...reviewState })
        : receiptRejectionDisabled({ rejectionReason, ...reviewState });
    if (actionDisabled) {
      if (formInvalid || this.receiptQuery.isPending()) {
        this.form.markAllAsTouched();
      }
      if (status === 'approved' && !evidenceAvailable) {
        this.notifications.showError(receiptEvidenceUnavailableNotice);
      }
      if (status === 'rejected' && rejectionReason.length === 0) {
        this.notifications.showError(
          'Enter the reason that will be shown to the submitter.',
        );
      }
      return;
    }

    const value = this.form.getRawValue();
    if (!this.selectableCountries().includes(value.purchaseCountry)) {
      this.notifications.showError('Selected purchase country is not allowed');
      return;
    }

    const parseAmount = (amount: number): null | number => {
      const parsed = majorCurrencyInputToMinorUnits(String(amount), false);
      return 'value' in parsed && typeof parsed.value === 'number'
        ? parsed.value
        : null;
    };
    const totalAmount = parseAmount(value.totalAmount);
    const taxAmount = parseAmount(value.taxAmount);
    const depositAmount = parseAmount(value.depositAmount);
    const alcoholAmount = parseAmount(value.alcoholAmount);
    if (
      totalAmount === null ||
      taxAmount === null ||
      depositAmount === null ||
      alcoholAmount === null
    ) {
      this.notifications.showError(
        'Enter amounts with no more than two decimal places',
      );
      return;
    }

    const amountError = validateFinanceReceiptAmounts({
      alcoholAmount,
      depositAmount,
      hasAlcohol: value.hasAlcohol,
      hasDeposit: value.hasDeposit,
      taxAmount,
      totalAmount,
    });
    if (amountError) {
      const message = {
        alcoholAmountOutOfRange: 'Alcohol amount is outside the allowed range',
        alcoholFlagContradiction:
          'Alcohol amount must be positive when alcohol is included and zero otherwise',
        depositAmountOutOfRange: 'Deposit amount is outside the allowed range',
        depositAndAlcoholExceedTotal:
          'Deposit and alcohol amounts cannot exceed total amount',
        depositFlagContradiction:
          'Deposit amount must be positive when a deposit is included and zero otherwise',
        taxAmountExceedsTotal: 'Tax amount cannot exceed total amount',
        taxAmountOutOfRange: 'Tax amount is outside the allowed range',
        totalAmountOutOfRange:
          'Total amount must be at least 0.01 and within the allowed range',
      } as const;
      this.notifications.showError(message[amountError]);
      return;
    }

    if (!isFinanceReceiptCalendarDate(value.receiptDate)) {
      this.notifications.showError('Enter a valid receipt date');
      return;
    }

    this.reviewPhase.set('saving');
    try {
      await this.reviewMutation.mutateAsync({
        alcoholAmount,
        depositAmount,
        hasAlcohol: value.hasAlcohol,
        hasDeposit: value.hasDeposit,
        id: receiptId,
        purchaseCountry: value.purchaseCountry,
        receiptDate: value.receiptDate,
        rejectionReason: status === 'rejected' ? rejectionReason : null,
        status,
        taxAmount,
        totalAmount,
      });
    } catch (error) {
      if (!stillCurrent()) return;
      const denial =
        error instanceof RpcUnauthorizedError
          ? 'Sign in again before reviewing this receipt.'
          : error instanceof RpcForbiddenError
            ? 'You do not have access to review this receipt. Check your active section and permissions.'
            : getErrorMessage(error, '', [
                'RpcBadRequestError',
                'FinanceReceiptNotFoundError',
                'FinanceResourceNotFoundError',
                'ReceiptMediaBadRequestError',
                'ReceiptMediaServiceUnavailableError',
              ]);
      this.reviewPhase.set(denial ? 'idle' : 'unknown');
      this.showReviewError(
        denial ||
          'The review outcome could not be confirmed. Load the page again and check the current receipt status before trying again.',
      );
      return;
    }

    if (stillCurrent()) this.reviewPhase.set('refreshing');
    try {
      await this.refreshReviewLists();
    } catch {
      if (!stillCurrent()) return;
      this.reviewPhase.set('saved');
      this.showReviewError(
        'The receipt review was saved, but the latest receipt lists could not be loaded. Load the page again to see the saved decision before making another change.',
      );
      return;
    }

    if (!stillCurrent()) return;
    this.reviewPhase.set('navigating');
    try {
      const navigated = await this.router.navigate([
        '/finance/receipts-approval',
      ]);
      if (!navigated)
        throw new Error('Receipt approval navigation did not complete');
    } catch {
      if (!stillCurrent()) return;
      this.reviewPhase.set('saved');
      this.showReviewError(
        'The receipt review was saved, but the approval list could not be opened. Open Receipt approvals again to see the saved decision.',
      );
      return;
    }
    // Successful owned navigation destroys this detail; its captured receipt still needs completion.
    if (!sameReceipt()) return;
    this.reviewPhase.set('saved');
    this.queryClient.removeQueries({
      exact: true,
      queryKey: this.rpc.finance.receipts.findOneForApproval.queryKey({
        id: receiptId,
      }),
    });
    this.notifications.showSuccess(receiptReviewSuccessMessage(status));
  }

  private showReviewError(message: string): void {
    this.reviewMessage.set(message);
    this.notifications.showError(message);
  }
}
