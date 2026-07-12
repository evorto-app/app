import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  Injectable,
  input,
  signal,
} from '@angular/core';
import {
  form,
  FormField,
  maxLength,
  min,
  minLength,
  required,
  submit,
  validate,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import type {
  PlatformFinanceReceiptWithSubmitterRecord,
  PlatformFinanceRefundRecoveryRecord,
  PlatformFinanceReimbursementGroup,
} from '../../../shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
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
  receipt: PlatformFinanceReceiptWithSubmitterRecord;
}

export const platformReceiptEvidenceUnavailableNotice =
  'Receipt evidence is unavailable. Approval is disabled until the uploaded file can be verified. You can still reject this receipt.';

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
    CurrencyPipe,
    DatePipe,
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
  protected readonly platformReceiptEvidenceUnavailableNotice =
    platformReceiptEvidenceUnavailableNotice;
  protected readonly platformReceiptReviewDisabled =
    platformReceiptReviewDisabled;
  protected readonly receiptCountryConfig = computed(() =>
    this.approvalQueueQuery.isSuccess()
      ? this.approvalQueueQuery.data().tenantContext.receiptCountryConfig
      : { allowOther: false, receiptCountries: [] },
  );
  protected readonly recoveryQueueQuery = injectQuery(() =>
    this.operations.recoveryQueue(this.tenantId()),
  );
  private readonly refundRecoveryModel = signal<RefundRecoveryModel>({
    reason: '',
    refundClaimId: '',
  });
  protected readonly refundRecoveryForm = form(
    this.refundRecoveryModel,
    (recovery) => {
      required(recovery.refundClaimId);
      required(recovery.reason, {
        message: 'Enter an operational reason.',
      });
      maxLength(recovery.reason, 500, {
        message: 'Reason must be 500 characters or fewer.',
      });
    },
  );
  protected readonly refundRecoveryMutation = injectMutation(() =>
    this.operations.requeueRefundClaim(),
  );
  private readonly reimbursementModel = signal<ReimbursementModel>({
    payoutType: '',
    reason: '',
    receiptIds: [],
  });
  protected readonly reimbursementForm = form(
    this.reimbursementModel,
    (reimbursement) => {
      required(reimbursement.payoutType, { message: 'Select a payout type.' });
      minLength(reimbursement.receiptIds, 1);
      maxLength(reimbursement.receiptIds, 100, {
        message: 'Select at most 100 receipts in one reimbursement batch.',
      });
      required(reimbursement.reason, {
        message: 'Enter an operational reason.',
      });
      maxLength(reimbursement.reason, 500, {
        message: 'Reason must be 500 characters or fewer.',
      });
    },
  );
  protected readonly reimbursementMutation = injectMutation(() =>
    this.operations.recordReimbursement(),
  );
  protected readonly reimbursementQueueQuery = injectQuery(() =>
    this.operations.reimbursementQueue(this.tenantId()),
  );
  private readonly reviewModel = signal<ReceiptReviewModel>(emptyReview());

  protected readonly reviewForm = form(this.reviewModel, (review) => {
    required(review.id);
    required(review.purchaseCountry, { message: 'Select a purchase country.' });
    required(review.receiptDate, { message: 'Enter the receipt date.' });
    required(review.reason, { message: 'Enter an operational reason.' });
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
    min(review.totalAmount, 0);
    for (const amount of [
      review.alcoholAmount,
      review.depositAmount,
      review.taxAmount,
      review.totalAmount,
    ]) {
      validate(amount, ({ value }) =>
        Number.isInteger(value())
          ? undefined
          : {
              kind: 'minorUnitInteger',
              message: 'Enter a whole number of minor currency units.',
            },
      );
    }
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
    signal<null | PlatformFinanceReimbursementGroup>(null);
  protected readonly selectedReimbursementTotal = computed(() => {
    const group = this.selectedReimbursement();
    if (!group) return 0;
    const selectedIds = new Set(this.reimbursementModel().receiptIds);
    let total = 0;
    for (const receipt of group.receipts) {
      if (selectedIds.has(receipt.id)) total += receipt.totalAmount;
    }
    return total;
  });
  protected readonly transactionColumns = [
    'createdAt',
    'amount',
    'status',
    'method',
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

  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  protected changeTransactionPage(event: PageEvent): void {
    this.transactionPageIndex.set(event.pageIndex);
    this.transactionPageSize.set(event.pageSize);
  }

  protected chooseReceipt(
    receipt: PlatformFinanceReceiptWithSubmitterRecord,
    eventTitle: string,
    eventStart: string,
  ): void {
    this.selectedReceipt.set({ eventStart, eventTitle, receipt });
    this.reviewModel.set({
      alcoholAmount: receipt.alcoholAmount,
      depositAmount: receipt.depositAmount,
      hasAlcohol: receipt.hasAlcohol,
      hasDeposit: receipt.hasDeposit,
      id: receipt.id,
      purchaseCountry: receipt.purchaseCountry,
      reason: '',
      receiptDate: receipt.receiptDate.slice(0, 10),
      rejectionReason: '',
      status: 'approved',
      taxAmount: receipt.taxAmount,
      totalAmount: receipt.totalAmount,
    });
    this.reviewForm().reset();
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
    this.selectedReimbursement.set(group);
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
      const selectedGroup = this.selectedReimbursement();
      const payoutVersion =
        reimbursement.payoutType === 'paypal'
          ? selectedGroup?.payoutVersions.paypal
          : selectedGroup?.payoutVersions.iban;
      if (!payoutVersion) return;

      try {
        const result = await this.reimbursementMutation.mutateAsync({
          payoutType: reimbursement.payoutType,
          payoutVersion,
          reason: reimbursement.reason,
          receiptIds: [firstReceiptId, ...remainingReceiptIds],
          targetTenantId: this.tenantId(),
        });
        await this.refreshFinance();
        this.notifications.showSuccess(
          `Recorded reimbursement for ${result.receiptCount} receipts`,
        );
        this.selectedReimbursement.set(null);
        this.reimbursementModel.set({
          payoutType: '',
          reason: '',
          receiptIds: [],
        });
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to record reimbursement'),
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
        await this.refreshFinance();
        this.notifications.showSuccess(
          result.mode === 'newGeneration'
            ? 'Terminal refund scheduled as a new safe generation'
            : 'Exhausted refund processing resumed',
        );
        this.selectedRefundClaim.set(null);
        this.refundRecoveryModel.set({ reason: '', refundClaimId: '' });
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to requeue refund claim'),
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
        await this.refreshFinance();
        this.notifications.showSuccess(
          review.status === 'approved'
            ? 'Receipt approved'
            : 'Receipt rejected',
        );
        this.selectedReceipt.set(null);
        this.reviewModel.set(emptyReview());
      } catch (error) {
        this.notifications.showError(
          getErrorMessage(error, 'Failed to review receipt'),
        );
      }
    });
  }

  protected toggleReimbursementReceipt(
    receiptId: string,
    selected: boolean,
  ): void {
    const current = this.reimbursementModel();
    const receiptIds = selected
      ? current.receiptIds.includes(receiptId) ||
        current.receiptIds.length >= 100
        ? current.receiptIds
        : [...current.receiptIds, receiptId]
      : current.receiptIds.filter((id) => id !== receiptId);
    this.reimbursementModel.set({ ...current, receiptIds });
  }

  private async refreshFinance(): Promise<void> {
    await this.queryClient.invalidateQueries(this.operations.financeFilter());
  }
}
