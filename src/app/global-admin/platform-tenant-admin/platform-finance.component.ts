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
  maxLength,
  required,
  submit,
} from '@angular/forms/signals';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
  MatPaginatorModule,
  type PageEvent,
} from '@angular/material/paginator';
import { MatTabsModule } from '@angular/material/tabs';
import {
  injectMutation,
  injectQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import type {
  PlatformFinanceCheckoutRecoveryClaim,
  PlatformFinanceRefundRecoveryRecord,
} from '../../../shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';

import {
  RpcForbiddenError,
  RpcUnauthorizedError,
} from '../../../shared/errors/rpc-errors';
import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import { NotificationService } from '../../core/notification.service';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import { PlatformTenantPageHeaderComponent } from './platform-tenant-page-header.component';

interface CheckoutRecoveryModel {
  claimId: string;
  expectedVersion: string;
  reason: string;
}

interface FinanceOutcome {
  kind: 'confirmed' | 'unknown';
  readState: 'failed' | 'paused' | 'unchecked';
  summary: string;
}

interface RefundRecoveryModel {
  reason: string;
  refundClaimId: string;
}

@Injectable({ providedIn: 'root' })
export class PlatformFinanceOperations {
  private readonly rpc = AppRpc.injectClient();

  checkoutRecoveryQueue(input: {
    limit: number;
    offset: number;
    targetTenantId: string;
  }) {
    return this.rpc.platform.finance.checkoutClaims.recoveryQueue.queryOptions(
      input,
    );
  }

  recoverCheckout() {
    return this.rpc.platform.finance.checkoutClaims.recover.mutationOptions();
  }

  financeFilter() {
    return this.rpc.queryFilter(['platform', 'finance']);
  }

  recoveryQueue(targetTenantId: string) {
    return this.rpc.platform.finance.refundClaims.recoveryQueue.queryOptions({
      targetTenantId,
    });
  }

  requeueRefundClaim() {
    return this.rpc.platform.finance.refundClaims.requeue.mutationOptions();
  }
}

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: '@container block min-w-0' },
  imports: [
    CurrencyPipe,
    TenantDatePipe,
    FormField,
    MatButtonModule,

    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,

    MatTabsModule,
    PlatformTenantPageHeaderComponent,
  ],
  selector: 'app-platform-finance',
  templateUrl: './platform-finance.component.html',
})
export class PlatformFinanceComponent {
  readonly tenantId = input.required<string>();

  private readonly operations = inject(PlatformFinanceOperations);
  protected readonly financeAction = signal<
    'checkout' | 'read' | 'refund' | null
  >(null);
  protected readonly financeActionBusy = computed(
    () => this.financeAction() !== null,
  );

  protected readonly financeOutcome = signal<FinanceOutcome | null>(null);
  protected readonly financeActionsDisabled = computed(
    () => this.financeActionBusy() || this.financeOutcome() !== null,
  );
  protected readonly financePhase = signal<
    'confirming' | 'refreshing' | 'saving' | null
  >(null);
  protected readonly recoveryQueueQuery = injectQuery(() =>
    this.operations.recoveryQueue(this.tenantId()),
  );
  protected readonly checkoutPageIndex = signal(0);
  protected readonly checkoutPageSize = signal(25);
  protected readonly checkoutRecoveryQueueQuery = injectQuery(() =>
    this.operations.checkoutRecoveryQueue({
      limit: this.checkoutPageSize(),
      offset: this.checkoutPageIndex() * this.checkoutPageSize(),
      targetTenantId: this.tenantId(),
    }),
  );
  protected readonly selectedCheckoutClaim =
    signal<null | PlatformFinanceCheckoutRecoveryClaim>(null);
  private readonly checkoutRecoveryModel = signal<CheckoutRecoveryModel>({
    claimId: '',
    expectedVersion: '',
    reason: '',
  });
  protected readonly checkoutRecoveryForm = form(
    this.checkoutRecoveryModel,
    (recovery) => {
      disabled(recovery, () => this.financeActionsDisabled());
      required(recovery.claimId);
      required(recovery.expectedVersion);
      required(recovery.reason, { message: 'Enter a reason for this action.' });
      maxLength(recovery.reason, 500);
    },
  );
  protected readonly checkoutRecoveryMutation = injectMutation(() =>
    this.operations.recoverCheckout(),
  );
  private readonly refundRecoveryModel = signal<RefundRecoveryModel>({
    reason: '',
    refundClaimId: '',
  });
  protected readonly refundRecoveryForm = form(
    this.refundRecoveryModel,
    (recovery) => {
      disabled(recovery, () => this.financeActionsDisabled());
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
  protected readonly selectedRefundClaim =
    signal<null | PlatformFinanceRefundRecoveryRecord>(null);
  private readonly notifications = inject(NotificationService);
  private readonly queryClient = inject(QueryClient);

  constructor() {
    effect(() => {
      this.tenantId();
      untracked(() => this.resetTenantScopedState());
    });
  }

  protected chooseRefundClaim(
    claim: PlatformFinanceRefundRecoveryRecord,
  ): void {
    if (this.financeActionsDisabled()) return;
    this.selectedRefundClaim.set(claim);
    this.refundRecoveryModel.set({
      reason: '',
      refundClaimId: claim.id,
    });
    this.refundRecoveryForm().reset();
  }

  protected chooseCheckoutClaim(
    claim: PlatformFinanceCheckoutRecoveryClaim,
  ): void {
    if (this.financeActionsDisabled()) return;
    this.selectedCheckoutClaim.set(claim);
    this.checkoutRecoveryModel.set({
      claimId: claim.id,
      expectedVersion: claim.version,
      reason: '',
    });
    this.checkoutRecoveryForm().reset();
  }

  protected changeCheckoutPage(event: PageEvent): void {
    if (this.financeActionsDisabled()) return;
    this.checkoutPageIndex.set(event.pageIndex);
    this.checkoutPageSize.set(event.pageSize);
    this.clearCheckoutSelection();
  }

  protected recoverCheckout(event: Event): void {
    event.preventDefault();
    if (
      this.financeActionsDisabled() ||
      this.checkoutRecoveryForm().submitting()
    )
      return;
    void submit(this.checkoutRecoveryForm, async () => {
      if (this.financeActionsDisabled()) return;
      const recovery = this.checkoutRecoveryModel();
      const selected = this.selectedCheckoutClaim();
      const targetTenantId = this.tenantId();
      this.financeAction.set('checkout');
      this.financePhase.set('saving');
      let recordedSummary: string | undefined;
      try {
        const result = await this.checkoutRecoveryMutation.mutateAsync({
          ...recovery,
          targetTenantId,
        });
        recordedSummary =
          result.sessionState === 'open'
            ? 'Payment link restored. The attendee can return to the event to continue paying.'
            : 'Existing payment linked. Its final status is being checked.';
        this.financePhase.set('refreshing');
        const readState = await this.refreshFinance();
        if (this.tenantId() !== targetTenantId) return;
        if (readState === 'paused') {
          this.financeOutcome.set({
            kind: 'confirmed',
            readState,
            summary: recordedSummary,
          });
          return;
        }
        this.notifications.showSuccess(recordedSummary);
        if (this.selectedCheckoutClaim() === selected)
          this.clearCheckoutSelection();
      } catch (error) {
        if (this.tenantId() !== targetTenantId) return;
        if (recordedSummary) {
          this.financeOutcome.set({
            kind: 'confirmed',
            readState: 'failed',
            summary: recordedSummary,
          });
        } else {
          const denial =
            error instanceof RpcUnauthorizedError
              ? 'Sign in again, then check the latest finance information.'
              : error instanceof RpcForbiddenError
                ? 'Your account does not have access to restore this payment setup.'
                : getErrorMessage(error, '', ['RpcBadRequestError']);
          if (denial) this.notifications.showError(denial);
          else
            this.financeOutcome.set({
              kind: 'unknown',
              readState: 'unchecked',
              summary:
                "We couldn't confirm whether the payment setup was restored. Your selection and reason are still here.",
            });
        }
      } finally {
        this.financePhase.set(null);
        this.financeAction.set(null);
      }
    });
  }

  protected requeueRefundClaim(event: Event): void {
    event.preventDefault();
    if (this.financeActionsDisabled() || this.refundRecoveryForm().submitting())
      return;

    void submit(this.refundRecoveryForm, async () => {
      if (this.financeActionsDisabled()) return;
      const recovery = this.refundRecoveryModel();
      const selectedClaim = this.selectedRefundClaim();
      const targetTenantId = this.tenantId();
      this.financeAction.set('refund');
      this.financePhase.set('saving');
      let recordedSummary: string | undefined;
      try {
        const result = await this.refundRecoveryMutation.mutateAsync({
          reason: recovery.reason,
          refundClaimId: recovery.refundClaimId,
          targetTenantId,
        });
        recordedSummary =
          result.mode === 'newGeneration'
            ? 'The refund will be tried again'
            : 'Refund continued';
        this.financePhase.set('refreshing');
        const readState = await this.refreshFinance();
        if (this.tenantId() !== targetTenantId) return;
        if (readState === 'paused') {
          this.financeOutcome.set({
            kind: 'confirmed',
            readState,
            summary: recordedSummary,
          });
          return;
        }
        this.notifications.showSuccess(recordedSummary);
        if (this.selectedRefundClaim() === selectedClaim) {
          this.selectedRefundClaim.set(null);
          this.refundRecoveryModel.set({ reason: '', refundClaimId: '' });
        }
      } catch (error) {
        if (this.tenantId() !== targetTenantId) return;
        if (recordedSummary) {
          this.financeOutcome.set({
            kind: 'confirmed',
            readState: 'failed',
            summary: recordedSummary,
          });
        } else {
          const denial =
            error instanceof RpcUnauthorizedError
              ? 'Sign in again, then check the latest finance information before continuing.'
              : error instanceof RpcForbiddenError
                ? 'Your account does not have access to this finance action. Ask an administrator to check your access.'
                : getErrorMessage(error, '', ['RpcBadRequestError']);
          if (denial) this.notifications.showError(denial);
          else
            this.financeOutcome.set({
              kind: 'unknown',
              readState: 'unchecked',
              summary:
                "We couldn't confirm whether this refund action was recorded. Your selection and reason are still here.",
            });
        }
      } finally {
        this.financePhase.set(null);
        this.financeAction.set(null);
      }
    });
  }

  protected async showLatestFinance(): Promise<void> {
    if (this.financeActionBusy()) return;
    const outcome = this.financeOutcome();
    if (!outcome) return;
    const targetTenantId = this.tenantId();
    this.financeAction.set('read');
    this.financePhase.set('refreshing');
    try {
      const readState = await this.refreshFinance();
      if (
        this.tenantId() !== targetTenantId ||
        this.financeOutcome() !== outcome
      )
        return;
      if (readState === 'paused') {
        this.financeOutcome.set({ ...outcome, readState });
        return;
      }
      this.clearCheckoutSelection();
      this.selectedRefundClaim.set(null);
      this.refundRecoveryModel.set({ reason: '', refundClaimId: '' });
      this.refundRecoveryForm().reset();
      this.financeOutcome.set(null);
      this.notifications.showSuccess(
        'Latest finance information loaded. Select a record to continue.',
      );
    } catch {
      if (
        this.tenantId() === targetTenantId &&
        this.financeOutcome() === outcome
      ) {
        this.financeOutcome.set({ ...outcome, readState: 'failed' });
      }
    } finally {
      this.financePhase.set(null);
      this.financeAction.set(null);
    }
  }

  private async refreshFinance(): Promise<'fresh' | 'paused'> {
    const filter = this.operations.financeFilter();
    const reads = this.queryClient
      .getQueryCache()
      .findAll({ ...filter, type: 'active' })
      .filter((query) => !query.isDisabled() && !query.isStatic());
    const invalidation = this.queryClient.invalidateQueries(filter, {
      throwOnError: true,
    });
    // TanStack resolves refetchQueries immediately for an initially paused read.
    // That is not evidence that the current finance state was loaded.
    const wasPaused = reads.some(
      (query) => query.state.fetchStatus === 'paused',
    );
    const siblings = reads
      .filter((query) => query.state.fetchStatus === 'fetching')
      .map((query) => query.promise);
    const results = await Promise.allSettled([invalidation, ...siblings]);
    const failures: unknown[] = [];
    for (const result of results) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Finance follow-up reads failed');
    if (
      wasPaused ||
      reads.some((query) => query.state.fetchStatus === 'paused')
    )
      return 'paused';
    if (
      reads.some(
        (query) =>
          query.state.status !== 'success' ||
          query.state.fetchStatus !== 'idle' ||
          query.state.isInvalidated,
      )
    ) {
      throw new Error(
        'Finance follow-up reads did not finish with fresh information',
      );
    }
    return 'fresh';
  }

  private clearCheckoutSelection(): void {
    this.selectedCheckoutClaim.set(null);
    this.checkoutRecoveryModel.set({
      claimId: '',
      expectedVersion: '',
      reason: '',
    });
    this.checkoutRecoveryForm().reset();
  }

  private resetTenantScopedState(): void {
    this.financeOutcome.set(null);
    this.checkoutPageIndex.set(0);
    this.clearCheckoutSelection();

    this.selectedRefundClaim.set(null);
    this.refundRecoveryModel.set({ reason: '', refundClaimId: '' });
    this.refundRecoveryForm().reset();
  }
}
