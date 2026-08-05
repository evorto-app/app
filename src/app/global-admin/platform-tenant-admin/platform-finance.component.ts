import { CurrencyPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  Injectable,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  disabled,
  form,
  FormField,
  max,
  maxLength,
  min,
  minLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  MatPaginatorModule,
  type PageEvent,
} from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import {
  isFinanceReceiptCalendarDate,
  maximumFinanceReceiptMinorUnits,
  validateFinanceReceiptAmounts,
} from '@shared/finance/receipt-values';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import type {
  PlatformFinanceReceiptApprovalDetailRecord,
  PlatformFinanceReceiptWithSubmitterRecord,
  PlatformFinanceRefundLifecycleSummary,
  PlatformFinanceRefundRecoveryRecord,
  PlatformFinanceReimbursementGroup,
  PlatformFinanceTenantContext,
  PlatformFinanceTransactionRecord,
} from '../../../shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { countryLabel } from '../../core/geography-labels';
import { NotificationService } from '../../core/notification.service';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import {
  type ReimbursementConfirmationData,
  ReimbursementConfirmationDialogComponent,
} from '../../finance/shared/reimbursement-confirmation-dialog/reimbursement-confirmation-dialog.component';
import { CurrencyAmountInputComponent } from '../../shared/components/controls/currency-amount-input/currency-amount-input.component';
import { PlatformTenantPageHeaderComponent } from './platform-tenant-page-header.component';

interface ReceiptReviewModel {
  alcoholAmount: number;
  depositAmount: number;
  hasAlcohol: boolean;
  hasDeposit: boolean;
  id: string;
  purchaseCountry: string;
  reason: string;
  receiptDate: string;
  rejectionReason: string;
  status: 'approved' | 'rejected';
  taxAmount: number;
  totalAmount: number;
}

interface RefundRecoveryModel {
  reason: string;
  refundClaimId: string;
}

interface ReimbursementModel {
  payoutType: '' | 'iban' | 'paypal';
  reason: string;
  receiptIds: string[];
}

interface SelectedReceiptContext {
  eventStart: string;
  eventTitle: string;
  receipt: PlatformFinanceReceiptApprovalDetailRecord;
}

interface SelectedReimbursementContext {
  group: PlatformFinanceReimbursementGroup;
  timezone: PlatformFinanceTenantContext['timezone'];
}

export const platformTransactionMethodLabel = (
  method: PlatformFinanceTransactionRecord['method'],
): string => {
  switch (method) {
    case 'cash': {
      return 'Cash';
    }
    case 'paypal': {
      return 'PayPal';
    }
    case 'stripe': {
      return 'Online payment';
    }
    case 'transfer': {
      return 'Bank transfer';
    }
  }
};

export const platformTransactionStatusLabel = (
  status: PlatformFinanceTransactionRecord['status'],
): string => {
  switch (status) {
    case 'cancelled': {
      return 'Cancelled';
    }
    case 'pending': {
      return 'In progress';
    }
    case 'successful': {
      return 'Completed';
    }
  }
};

export const platformReceiptEvidenceUnavailableNotice =
  'The uploaded receipt file is unavailable. Approval is disabled until it can be checked. You can still reject this receipt.';

export const platformReceiptReviewDisabled = ({
  evidenceAvailable,
  formInvalid,
  mutationPending,
  status,
}: {
  evidenceAvailable: boolean;
  formInvalid: boolean;
  mutationPending: boolean;
  status: 'approved' | 'rejected';
}): boolean =>
  formInvalid ||
  mutationPending ||
  (status === 'approved' && !evidenceAvailable);

export interface PlatformRefundLifecycleCopy {
  readonly detail: string;
  readonly label: string;
}

export const platformRefundLifecycleCopy = (
  summary: PlatformFinanceRefundLifecycleSummary,
): PlatformRefundLifecycleCopy => {
  switch (summary.status) {
    case 'action-required': {
      return {
        detail: summary.recoveryMode
          ? "Complete the required step in the organization's payment account, then open Refunds needing attention to continue."
          : "Complete the required step in the organization's payment account, then select Show latest status. This shows any update Evorto has received.",
        label: 'Payment action needed',
      };
    }
    case 'needs-attention': {
      return {
        detail: summary.recoveryMode
          ? 'This refund did not finish. Open Refunds needing attention to review what can be done.'
          : "This refund did not finish. Check it in the organization's payment account, then contact Evorto support before changing its status in Evorto.",
        label: 'Needs attention',
      };
    }
    case 'pending': {
      return {
        detail: 'The refund has not started yet.',
        label: 'Waiting',
      };
    }
    case 'retrying': {
      return {
        detail: 'The refund will be tried again.',
        label: 'Trying again',
      };
    }
    case 'succeeded': {
      return {
        detail: 'The refund is complete.',
        label: 'Refunded',
      };
    }
  }
};

const emptyReview = (): ReceiptReviewModel => ({
  alcoholAmount: 0,
  depositAmount: 0,
  hasAlcohol: false,
  hasDeposit: false,
  id: '',
  purchaseCountry: '',
  reason: '',
  receiptDate: '',
  rejectionReason: '',
  status: 'approved',
  taxAmount: 0,
  totalAmount: 0,
});

@Injectable({ providedIn: 'root' })
export class PlatformFinanceOperations {
  private readonly rpc = AppRpc.injectClient();

  approvalDetail(targetTenantId: string, id: string) {
    return this.rpc.platform.finance.receipts.approvalDetail.queryOptions({
      id,
      targetTenantId,
    });
  }

  approvalQueue(targetTenantId: string) {
    return this.rpc.platform.finance.receipts.approvalQueue.queryOptions({
      targetTenantId,
    });
  }

  financeFilter() {
    return this.rpc.queryFilter(['platform', 'finance']);
  }

  recordReimbursement() {
    return this.rpc.platform.finance.receipts.recordReimbursement.mutationOptions();
  }

  recoveryQueue(targetTenantId: string) {
    return this.rpc.platform.finance.refundClaims.recoveryQueue.queryOptions({
      targetTenantId,
    });
  }

  reimbursementQueue(targetTenantId: string) {
    return this.rpc.platform.finance.receipts.reimbursementQueue.queryOptions({
      targetTenantId,
    });
  }

  requeueRefundClaim() {
    return this.rpc.platform.finance.refundClaims.requeue.mutationOptions();
  }

  reviewReceipt() {
    return this.rpc.platform.finance.receipts.review.mutationOptions();
  }

  transactions(input: {
    limit: number;
    offset: number;
    targetTenantId: string;
  }) {
    return this.rpc.platform.finance.transactions.findMany.queryOptions({
      limit: input.limit,
      offset: input.offset,
      targetTenantId: input.targetTenantId,
    });
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyAmountInputComponent,
    CurrencyPipe,
    TenantDatePipe,
    FormField,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSelectModule,
    MatTableModule,
    MatTabsModule,
    PlatformTenantPageHeaderComponent,
  ],
  selector: 'app-platform-finance',
  templateUrl: './platform-finance.component.html',
})
export class PlatformFinanceComponent {
  readonly tenantId = input.required<string>();

  private readonly operations = inject(PlatformFinanceOperations);
  protected readonly approvalQueueQuery = injectQuery(() =>
    this.operations.approvalQueue(this.tenantId()),
  );
  protected readonly countryLabel = countryLabel;
  protected readonly platformReceiptEvidenceUnavailableNotice =
    platformReceiptEvidenceUnavailableNotice;
  protected readonly platformReceiptReviewDisabled =
    platformReceiptReviewDisabled;
  protected readonly platformTransactionMethodLabel =
    platformTransactionMethodLabel;
  protected readonly platformTransactionStatusLabel =
    platformTransactionStatusLabel;
  protected readonly receiptCountryConfig = computed(() =>
    this.approvalQueueQuery.isSuccess()
      ? this.approvalQueueQuery.data().tenantContext.receiptCountryConfig
      : { allowOther: false, receiptCountries: [] },
  );
  protected readonly receiptDetailPending = signal(false);
  protected readonly recoveryQueueQuery = injectQuery(() =>
    this.operations.recoveryQueue(this.tenantId()),
  );
  protected readonly refundLifecycleCopy = platformRefundLifecycleCopy;
  private readonly refundRecoveryModel = signal<RefundRecoveryModel>({
    reason: '',
    refundClaimId: '',
  });
  protected readonly refundRecoveryForm = form(
    this.refundRecoveryModel,
    (recovery) => {
      required(recovery.refundClaimId);
      required(recovery.reason, {
        message: 'Enter a reason for this action.',
      });
      maxLength(recovery.reason, 500, {
        message: 'Reason must be 500 characters or fewer.',
      });
    },
  );
  protected readonly refundRecoveryMutation = injectMutation(() =>
    this.operations.requeueRefundClaim(),
  );
  protected readonly reimbursementMutation = injectMutation(() =>
    this.operations.recordReimbursement(),
  );
  private readonly reimbursementModel = signal<ReimbursementModel>({
    payoutType: '',
    reason: '',
    receiptIds: [],
  });
  protected readonly reimbursementForm = form(
    this.reimbursementModel,
    (reimbursement) => {
      disabled(reimbursement.payoutType, () =>
        this.reimbursementMutation.isPending(),
      );
      disabled(reimbursement.reason, () =>
        this.reimbursementMutation.isPending(),
      );
      disabled(reimbursement.receiptIds, () =>
        this.reimbursementMutation.isPending(),
      );
      required(reimbursement.payoutType, { message: 'Select a payout type.' });
      minLength(reimbursement.receiptIds, 1);
      maxLength(reimbursement.receiptIds, 100, {
        message: 'Select at most 100 receipts at a time.',
      });
      required(reimbursement.reason, {
        message: 'Enter a reason for this reimbursement.',
      });
      maxLength(reimbursement.reason, 500, {
        message: 'Reason must be 500 characters or fewer.',
      });
    },
  );
  protected readonly reimbursementQueueQuery = injectQuery(() =>
    this.operations.reimbursementQueue(this.tenantId()),
  );

  private readonly reviewModel = signal<ReceiptReviewModel>(emptyReview());
  protected readonly reviewForm = form(this.reviewModel, (review) => {
    required(review.id);
    required(review.purchaseCountry, { message: 'Select a purchase country.' });
    required(review.receiptDate, { message: 'Enter the receipt date.' });
    required(review.reason, { message: 'Enter a reason for this decision.' });
    maxLength(review.reason, 500, {
      message: 'Reason must be 500 characters or fewer.',
    });
    required(review.rejectionReason, {
      message: 'Explain why the receipt is rejected.',
      when: ({ valueOf }) => valueOf(review.status) === 'rejected',
    });
    maxLength(review.rejectionReason, 500, {
      message: 'Rejection reason must be 500 characters or fewer.',
    });
    min(review.alcoholAmount, 0);
    min(review.depositAmount, 0);
    min(review.taxAmount, 0);
    min(review.totalAmount, 1);
    for (const amount of [
      review.alcoholAmount,
      review.depositAmount,
      review.taxAmount,
      review.totalAmount,
    ]) {
      max(amount, maximumFinanceReceiptMinorUnits);
      validate(amount, ({ value }) =>
        Number.isInteger(value())
          ? undefined
          : {
              kind: 'minorUnitInteger',
              message: 'Enter an amount with no more than two decimal places.',
            },
      );
    }
    validate(review.receiptDate, ({ value }) =>
      isFinanceReceiptCalendarDate(value())
        ? undefined
        : {
            kind: 'calendarDate',
            message: 'Enter a valid receipt date.',
          },
    );
    validate(review.totalAmount, ({ valueOf }) =>
      validateFinanceReceiptAmounts({
        alcoholAmount: valueOf(review.alcoholAmount),
        depositAmount: valueOf(review.depositAmount),
        hasAlcohol: valueOf(review.hasAlcohol),
        hasDeposit: valueOf(review.hasDeposit),
        taxAmount: valueOf(review.taxAmount),
        totalAmount: valueOf(review.totalAmount),
      })
        ? {
            kind: 'receiptAmounts',
            message:
              'Amounts must match the deposit and alcohol choices and stay within the total.',
          }
        : undefined,
    );
  });
  protected readonly reviewMutation = injectMutation(() =>
    this.operations.reviewReceipt(),
  );
  protected readonly selectedReceipt = signal<null | SelectedReceiptContext>(
    null,
  );
  protected readonly selectedRefundClaim =
    signal<null | PlatformFinanceRefundRecoveryRecord>(null);

  protected readonly selectedReimbursement =
    signal<null | SelectedReimbursementContext>(null);
  protected readonly selectedReimbursementTotal = computed(() => {
    const selected = this.selectedReimbursement();
    if (!selected) return 0;
    const selectedIds = new Set(this.reimbursementModel().receiptIds);
    let total = 0;
    for (const receipt of selected.group.receipts) {
      if (selectedIds.has(receipt.id)) total += receipt.totalAmount;
    }
    return total;
  });
  protected readonly transactionColumns = [
    'createdAt',
    'amount',
    'status',
    'method',
    'refundLifecycle',
    'comment',
  ];
  protected readonly transactionPageIndex = signal(0);
  protected readonly transactionPageSize = signal(100);
  protected readonly transactionsQuery = injectQuery(() =>
    this.operations.transactions({
      limit: this.transactionPageSize(),
      offset: this.transactionPageIndex() * this.transactionPageSize(),
      targetTenantId: this.tenantId(),
    }),
  );

  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);
  private receiptDetailRequestId = 0;

  constructor() {
    effect(() => {
      this.tenantId();
      untracked(() => this.resetTenantScopedState());
    });
  }

  protected changeTransactionPage(event: PageEvent): void {
    this.transactionPageIndex.set(event.pageIndex);
    this.transactionPageSize.set(event.pageSize);
  }

  protected async chooseReceipt(
    receipt: PlatformFinanceReceiptWithSubmitterRecord,
  ): Promise<void> {
    if (this.receiptDetailPending()) return;

    const targetTenantId = this.tenantId();
    const requestId = ++this.receiptDetailRequestId;
    this.receiptDetailPending.set(true);
    this.selectedReceipt.set(null);
    this.reviewModel.set(emptyReview());
    this.reviewForm().reset();

    try {
      const detail = await this.queryClient.fetchQuery(
        this.operations.approvalDetail(targetTenantId, receipt.id),
      );
      if (
        this.receiptDetailRequestId !== requestId ||
        this.tenantId() !== targetTenantId
      ) {
        return;
      }

      this.selectedReceipt.set({
        eventStart: detail.receipt.eventStart,
        eventTitle: detail.receipt.eventTitle,
        receipt: detail.receipt,
      });
      this.reviewModel.set({
        alcoholAmount: detail.receipt.alcoholAmount,
        depositAmount: detail.receipt.depositAmount,
        hasAlcohol: detail.receipt.hasAlcohol,
        hasDeposit: detail.receipt.hasDeposit,
        id: detail.receipt.id,
        purchaseCountry: detail.receipt.purchaseCountry,
        reason: '',
        receiptDate: detail.receipt.receiptDate,
        rejectionReason: '',
        status: 'approved',
        taxAmount: detail.receipt.taxAmount,
        totalAmount: detail.receipt.totalAmount,
      });
      this.reviewForm().reset();
    } catch (error) {
      if (
        this.receiptDetailRequestId === requestId &&
        this.tenantId() === targetTenantId
      ) {
        this.notifications.showError(
          getErrorMessage(error, 'Receipt details could not be loaded', [
            'RpcBadRequestError',
            'FinanceReceiptNotFoundError',
            'FinanceResourceNotFoundError',
            'ReceiptMediaBadRequestError',
            'ReceiptMediaServiceUnavailableError',
          ]),
        );
      }
    } finally {
      if (this.receiptDetailRequestId === requestId) {
        this.receiptDetailPending.set(false);
      }
    }
  }

  protected chooseRefundClaim(
    claim: PlatformFinanceRefundRecoveryRecord,
  ): void {
    this.selectedRefundClaim.set(claim);
    this.refundRecoveryModel.set({
      reason: '',
      refundClaimId: claim.id,
    });
    this.refundRecoveryForm().reset();
  }

  protected chooseReimbursement(
    group: PlatformFinanceReimbursementGroup,
  ): void {
    if (this.reimbursementMutation.isPending()) return;
    if (!this.reimbursementQueueQuery.isSuccess()) {
      throw new Error(
        'Cannot select a reimbursement without its target tenant context',
      );
    }
    this.selectedReimbursement.set({
      group,
      timezone: this.reimbursementQueueQuery.data().tenantContext.timezone,
    });
    this.reimbursementModel.set({
      payoutType: group.payout.iban
        ? 'iban'
        : group.payout.paypalEmail
          ? 'paypal'
          : '',
      reason: '',
      receiptIds: group.receipts.slice(0, 100).map((receipt) => receipt.id),
    });
    this.reimbursementForm().reset();
  }

  protected receiptSelected(receiptId: string): boolean {
    return this.reimbursementModel().receiptIds.includes(receiptId);
  }

  protected recordReimbursement(event: Event): void {
    event.preventDefault();
    if (this.reimbursementMutation.isPending()) return;

    void submit(this.reimbursementForm, async () => {
      const reimbursement = this.reimbursementModel();
      const [firstReceiptId, ...remainingReceiptIds] = reimbursement.receiptIds;
      if (!firstReceiptId || !reimbursement.payoutType) return;
      const selectedReimbursement = this.selectedReimbursement();
      if (!selectedReimbursement) return;
      const selectedGroup = selectedReimbursement.group;
      const payoutVersion =
        reimbursement.payoutType === 'paypal'
          ? selectedGroup.payoutVersions.paypal
          : selectedGroup.payoutVersions.iban;
      const payoutDestination =
        reimbursement.payoutType === 'paypal'
          ? selectedGroup.payout.paypalEmail
          : selectedGroup.payout.iban;
      if (!payoutDestination || !payoutVersion) return;

      const targetTenantId = this.tenantId();
      const recipient =
        `${selectedGroup.submittedByFirstName} ${selectedGroup.submittedByLastName}`.trim() ||
        selectedGroup.submittedByEmail;
      const confirmation: ReimbursementConfirmationData = {
        currency: selectedGroup.currency,
        payoutDestination,
        payoutMethod:
          reimbursement.payoutType === 'paypal' ? 'PayPal' : 'Bank transfer',
        receiptCount: reimbursement.receiptIds.length,
        recipient,
        totalAmount: this.selectedReimbursementTotal(),
      };
      const confirmed = await firstValueFrom(
        this.dialog
          .open<
            ReimbursementConfirmationDialogComponent,
            ReimbursementConfirmationData,
            boolean
          >(ReimbursementConfirmationDialogComponent, {
            data: confirmation,
            width: 'min(38rem, calc(100vw - 2rem))',
          })
          .afterClosed(),
      );
      if (
        confirmed !== true ||
        this.reimbursementMutation.isPending() ||
        this.tenantId() !== targetTenantId
      ) {
        return;
      }

      try {
        const result = await this.reimbursementMutation.mutateAsync({
          payoutType: reimbursement.payoutType,
          payoutVersion,
          reason: reimbursement.reason,
          receiptIds: [firstReceiptId, ...remainingReceiptIds],
          targetTenantId,
        });
        this.refreshFinance();
        this.notifications.showSuccess(
          `Recorded reimbursement for ${result.receiptCount} receipts`,
        );
        if (this.selectedReimbursement() === selectedReimbursement) {
          this.selectedReimbursement.set(null);
          this.reimbursementModel.set({
            payoutType: '',
            reason: '',
            receiptIds: [],
          });
        }
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            'The reimbursement could not be recorded. Review the details and try again.',
            ['RpcBadRequestError'],
          ),
        );
      }
    });
  }

  protected requeueRefundClaim(event: Event): void {
    event.preventDefault();
    if (this.refundRecoveryMutation.isPending()) return;

    void submit(this.refundRecoveryForm, async () => {
      const recovery = this.refundRecoveryModel();
      try {
        const result = await this.refundRecoveryMutation.mutateAsync({
          reason: recovery.reason,
          refundClaimId: recovery.refundClaimId,
          targetTenantId: this.tenantId(),
        });
        this.refreshFinance();
        this.notifications.showSuccess(
          result.mode === 'newGeneration'
            ? 'The refund will be tried again'
            : 'Refund continued',
        );
        this.selectedRefundClaim.set(null);
        this.refundRecoveryModel.set({ reason: '', refundClaimId: '' });
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            'This refund action could not be saved. Try again.',
            ['RpcBadRequestError'],
          ),
        );
      }
    });
  }

  protected reviewReceipt(event: Event): void {
    event.preventDefault();
    if (this.reviewMutation.isPending()) return;

    void submit(this.reviewForm, async () => {
      const review = this.reviewModel();
      const evidenceAvailable =
        this.selectedReceipt()?.receipt.receiptEvidenceAvailable ?? false;
      if (review.status === 'approved' && !evidenceAvailable) {
        this.notifications.showError(platformReceiptEvidenceUnavailableNotice);
        return;
      }
      try {
        await this.reviewMutation.mutateAsync({
          alcoholAmount: review.alcoholAmount,
          depositAmount: review.depositAmount,
          hasAlcohol: review.hasAlcohol,
          hasDeposit: review.hasDeposit,
          id: review.id,
          purchaseCountry: review.purchaseCountry,
          reason: review.reason,
          receiptDate: review.receiptDate,
          rejectionReason:
            review.status === 'rejected' ? review.rejectionReason.trim() : null,
          status: review.status,
          targetTenantId: this.tenantId(),
          taxAmount: review.taxAmount,
          totalAmount: review.totalAmount,
        });
        this.refreshFinance();
        this.notifications.showSuccess(
          review.status === 'approved'
            ? 'Receipt approved'
            : 'Receipt rejected',
        );
        this.selectedReceipt.set(null);
        this.reviewModel.set(emptyReview());
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(
            error,
            'The receipt review could not be saved. Review the details and try again.',
            [
              'RpcBadRequestError',
              'FinanceReceiptNotFoundError',
              'FinanceResourceNotFoundError',
              'ReceiptMediaBadRequestError',
              'ReceiptMediaServiceUnavailableError',
            ],
          ),
        );
      }
    });
  }

  protected toggleReimbursementReceipt(
    receiptId: string,
    selected: boolean,
  ): void {
    if (this.reimbursementMutation.isPending()) return;
    const current = this.reimbursementModel();
    const receiptIds = selected
      ? current.receiptIds.includes(receiptId) ||
        current.receiptIds.length >= 100
        ? current.receiptIds
        : [...current.receiptIds, receiptId]
      : current.receiptIds.filter((id) => id !== receiptId);
    this.reimbursementModel.set({ ...current, receiptIds });
  }

  private refreshFinance(): void {
    // The mutation result is authoritative. Refetching the independent finance
    // queues must not keep the completed action pending when one active query
    // is slow or waiting on an external provider.
    void this.queryClient.invalidateQueries(this.operations.financeFilter());
  }

  private resetTenantScopedState(): void {
    this.transactionPageIndex.set(0);

    this.receiptDetailRequestId += 1;
    this.receiptDetailPending.set(false);
    this.selectedReceipt.set(null);
    this.reviewModel.set(emptyReview());
    this.reviewForm().reset();

    this.selectedReimbursement.set(null);
    this.reimbursementModel.set({ payoutType: '', reason: '', receiptIds: [] });
    this.reimbursementForm().reset();

    this.selectedRefundClaim.set(null);
    this.refundRecoveryModel.set({ reason: '', refundClaimId: '' });
    this.refundRecoveryForm().reset();
  }
}
