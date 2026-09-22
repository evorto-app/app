import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, input, LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatTabGroupHarness } from '@angular/material/tabs/testing';
import {
  createRpcQueryFilter,
  createRpcQueryKey,
} from '@heddendorp/effect-angular-query';
import {
  onlineManager,
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { of, Subject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '../../../shared/errors/rpc-errors';
import {
  PlatformFinanceReceiptApprovalDetailRecord,
  PlatformFinanceReceiptWithSubmitterRecord,
  PlatformFinanceRefundLifecycleSummary,
  PlatformFinanceRefundRecoveryRecord,
  PlatformFinanceReimbursementGroup,
  PlatformFinanceReimbursementReceipt,
  PlatformFinanceTenantContext,
} from '../../../shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';
import { NotificationService } from '../../core/notification.service';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import {
  type ReimbursementConfirmationData,
  ReimbursementConfirmationDialogComponent,
} from '../../finance/shared/reimbursement-confirmation-dialog/reimbursement-confirmation-dialog.component';
import {
  PlatformFinanceComponent,
  PlatformFinanceOperations,
  platformReceiptEvidenceUnavailableNotice,
  platformReceiptReviewDisabled,
  platformRefundLifecycleCopy,
  platformTransactionMethodLabel,
  platformTransactionStatusLabel,
} from './platform-finance.component';
import { PlatformTenantPageHeaderComponent } from './platform-tenant-page-header.component';

@Component({
  selector: 'app-platform-tenant-page-header',
  template: '',
})
class PlatformTenantPageHeaderStub {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();
}

describe('platform receipt review evidence gating', () => {
  it('explains that unavailable evidence blocks only approval', () => {
    expect(platformReceiptEvidenceUnavailableNotice).toBe(
      'The uploaded receipt file is unavailable. Approval is disabled until it can be checked. You can still reject this receipt.',
    );

    expect(
      platformReceiptReviewDisabled({
        evidenceAvailable: false,
        formInvalid: false,
        mutationPending: false,
        status: 'approved',
      }),
    ).toBe(true);
    expect(
      platformReceiptReviewDisabled({
        evidenceAvailable: false,
        formInvalid: false,
        mutationPending: false,
        status: 'rejected',
      }),
    ).toBe(false);
  });

  it('keeps normal form and mutation gating for both decisions', () => {
    expect(
      platformReceiptReviewDisabled({
        evidenceAvailable: true,
        formInvalid: true,
        mutationPending: false,
        status: 'approved',
      }),
    ).toBe(true);
    expect(
      platformReceiptReviewDisabled({
        evidenceAvailable: true,
        formInvalid: false,
        mutationPending: true,
        status: 'rejected',
      }),
    ).toBe(true);
  });
});

describe('platform transaction labels', () => {
  it('turns stored payment values into finance language', () => {
    expect(platformTransactionStatusLabel('cancelled')).toBe('Cancelled');
    expect(platformTransactionStatusLabel('pending')).toBe('In progress');
    expect(platformTransactionStatusLabel('successful')).toBe('Completed');

    expect(platformTransactionMethodLabel('cash')).toBe('Cash');
    expect(platformTransactionMethodLabel('paypal')).toBe('PayPal');
    expect(platformTransactionMethodLabel('stripe')).toBe('Online payment');
    expect(platformTransactionMethodLabel('transfer')).toBe('Bank transfer');
  });
});

describe('platform refund lifecycle copy', () => {
  it('uses actionable copy without provider failure details', () => {
    const copy = platformRefundLifecycleCopy(
      PlatformFinanceRefundLifecycleSummary.make({
        attempts: 8,
        maxAttempts: 8,
        recoveryMode: 'resumeGeneration',
        status: 'needs-attention',
      }),
    );

    expect(copy).toEqual({
      detail:
        'This refund did not finish. Open Refunds needing attention to review what can be done.',
      label: 'Needs attention',
    });
    expect(JSON.stringify(copy)).not.toContain('Stripe');
    expect(JSON.stringify(copy)).not.toContain('error');
  });

  it('does not direct non-requeueable attention states to Refund recovery', () => {
    const copy = platformRefundLifecycleCopy(
      PlatformFinanceRefundLifecycleSummary.make({
        attempts: 1,
        maxAttempts: 8,
        recoveryMode: null,
        status: 'needs-attention',
      }),
    );

    expect(copy).toEqual({
      detail:
        "This refund did not finish. Check it in the organization's payment account, then contact Evorto support before changing its status in Evorto.",
      label: 'Needs attention',
    });
  });

  it('opens recovery only for Stripe-account action claims that can be resumed', () => {
    const scheduled = platformRefundLifecycleCopy(
      PlatformFinanceRefundLifecycleSummary.make({
        attempts: 1,
        maxAttempts: 8,
        recoveryMode: null,
        status: 'action-required',
      }),
    );
    const stopped = platformRefundLifecycleCopy(
      PlatformFinanceRefundLifecycleSummary.make({
        attempts: 8,
        maxAttempts: 8,
        recoveryMode: 'resumeGeneration',
        status: 'action-required',
      }),
    );

    expect(scheduled.detail).toBe(
      "Complete the required step in the organization's payment account, then select Show latest status. This shows any update Evorto has received.",
    );
    expect(stopped.detail).toBe(
      "Complete the required step in the organization's payment account, then open Refunds needing attention to continue.",
    );
    expect(scheduled.detail).not.toContain('Stripe');
    expect(stopped.detail).not.toContain('Stripe');
    expect(scheduled.detail).not.toContain('when possible');
  });

  it('distinguishes all non-attention states', () => {
    const expectedLabels: readonly (readonly [
      PlatformFinanceRefundLifecycleSummary['status'],
      string,
    ])[] = [
      ['action-required', 'Payment action needed'],
      ['pending', 'Waiting'],
      ['retrying', 'Trying again'],
      ['succeeded', 'Refunded'],
    ];

    for (const [status, label] of expectedLabels) {
      expect(
        platformRefundLifecycleCopy(
          PlatformFinanceRefundLifecycleSummary.make({
            attempts: 1,
            maxAttempts: 8,
            recoveryMode: null,
            status,
          }),
        ).label,
      ).toBe(label);
    }
  });

  it('describes audit persistence as change history', () => {
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-tenant-admin/platform-finance.component.html',
      ),
      'utf8',
    );

    expect(template).toContain(
      'Required. This reason is saved with the action.',
    );
    expect(template).toContain('Try failed refund again');
    expect(template).toContain('This refund did not finish and needs review.');
    expect(template).toContain('No refunds currently need attention.');
    expect(template).toContain(
      'Separate from the rejection reason shown to the attendee.',
    );
    expect(template).toContain('Select a recipient to record a reimbursement.');
    expect(template).not.toContain('attendee-facing rejection reason');
    expect(template).not.toContain('Select a recipient group');
    expect(template).not.toContain('Automatic refund checks');
    expect(template).not.toContain('Resume refund checks');
    expect(template).not.toContain('Terminal refund');
    expect(template).not.toContain('Stopped refund processing');
    expect(template).not.toContain('application append-only platform audit');

    const source = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-tenant-admin/platform-finance.component.ts',
      ),
      'utf8',
    );
    expect(source).toContain('The refund will be tried again');
    expect(source).not.toContain('Failed refund will be tried again');
  });

  it('edits receipt values as ordinary amounts in the receipt currency', () => {
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-tenant-admin/platform-finance.component.html',
      ),
      'utf8',
    );

    expect(template.match(/<app-currency-amount-input/g)?.length).toBe(4);
    expect(template).toContain('[currencyCode]="selected.receipt.currency"');
    expect(template).not.toContain('minor units');
  });
});

const loadRecoveryQueue = vi.fn();
const loadApprovalDetail = vi.fn();
const loadApprovalQueue = vi.fn();
const loadReimbursementQueue = vi.fn();
const loadTransactions = vi.fn();
const openDialog = vi.fn();
type ReimbursementMutation = NonNullable<
  ReturnType<PlatformFinanceOperations['recordReimbursement']>['mutationFn']
>;
type ReimbursementResult = Awaited<ReturnType<ReimbursementMutation>>;
const recordedReimbursement: ReimbursementResult = {
  receiptCount: 2,
  totalAmount: 2900,
  transactionId: 'reimbursement-transaction',
};
const recordReimbursementMutation = vi.fn<ReimbursementMutation>();
const requeueRefundMutation =
  vi.fn<
    NonNullable<
      ReturnType<PlatformFinanceOperations['requeueRefundClaim']>['mutationFn']
    >
  >();
const reviewReceiptMutation =
  vi.fn<
    NonNullable<
      ReturnType<PlatformFinanceOperations['reviewReceipt']>['mutationFn']
    >
  >();

const tenantContext = PlatformFinanceTenantContext.make({
  currency: 'EUR',
  receiptCountryConfig: { allowOther: false, receiptCountries: ['DE'] },
  targetTenantId: 'tenant-1',
  timezone: 'Australia/Brisbane',
});

const approvalQueueReceipt = (id: string) =>
  PlatformFinanceReceiptWithSubmitterRecord.make({
    alcoholAmount: 0,
    attachmentFileName: `${id}.pdf`,
    attachmentMimeType: 'application/pdf',
    createdAt: '2026-07-10T10:00:00.000Z',
    currency: 'EUR',
    depositAmount: 0,
    eventId: `event-${id}`,
    hasAlcohol: false,
    hasDeposit: false,
    id,
    purchaseCountry: 'DE',
    receiptDate: '2026-07-09',
    refundedAt: null,
    refundTransactionId: null,
    rejectionReason: null,
    reviewedAt: null,
    status: 'submitted',
    submittedByEmail: 'participant@example.test',
    submittedByFirstName: 'Pat',
    submittedByLastName: 'Example',
    submittedByUserId: 'user-participant',
    taxAmount: 190,
    totalAmount: 1190,
    updatedAt: '2026-07-10T10:00:00.000Z',
  });

const approvalDetailReceipt = (id: string) =>
  PlatformFinanceReceiptApprovalDetailRecord.make({
    ...approvalQueueReceipt(id),
    eventStart: '2026-07-20T10:00:00.000Z',
    eventTitle: 'Approval event',
    previewImageUrl: `https://example.test/${id}.pdf`,
    receiptEvidenceAvailable: true,
  });

const reimbursementReceipt = (
  id: string,
  totalAmount: number,
  eventTitle: string,
) =>
  PlatformFinanceReimbursementReceipt.make({
    alcoholAmount: 0,
    attachmentFileName: `${id}.pdf`,
    attachmentMimeType: 'application/pdf',
    createdAt: '2026-07-10T10:00:00.000Z',
    currency: 'EUR',
    depositAmount: 0,
    eventId: `event-${id}`,
    eventStart: '2026-07-20T10:00:00.000Z',
    eventTitle,
    hasAlcohol: false,
    hasDeposit: false,
    id,
    purchaseCountry: 'DE',
    receiptDate: '2026-07-09',
    refundedAt: null,
    refundTransactionId: null,
    rejectionReason: null,
    reviewedAt: '2026-07-10T11:00:00.000Z',
    status: 'approved',
    submittedByEmail: 'ada@example.test',
    submittedByFirstName: 'Ada',
    submittedByLastName: 'Lovelace',
    submittedByUserId: 'user-ada',
    taxAmount: 0,
    totalAmount,
    updatedAt: '2026-07-10T11:00:00.000Z',
  });

const reimbursementConfirmationGroup = PlatformFinanceReimbursementGroup.make({
  currency: 'EUR',
  payout: {
    iban: 'DE89370400440532013000',
    paypalEmail: 'ada@example.test',
  },
  payoutVersions: { iban: 'iban-version-1', paypal: 'paypal-version-1' },
  receipts: [
    reimbursementReceipt('receipt-1', 1190, 'Welcome dinner'),
    reimbursementReceipt('receipt-2', 1710, 'City tour'),
  ],
  submittedByEmail: 'ada@example.test',
  submittedByFirstName: 'Ada',
  submittedByLastName: 'Lovelace',
  submittedByUserId: 'user-ada',
  totalAmount: 2900,
});

const newerReimbursementGroup = PlatformFinanceReimbursementGroup.make({
  currency: 'EUR',
  payout: {
    iban: null,
    paypalEmail: 'grace@example.test',
  },
  payoutVersions: { iban: null, paypal: 'paypal-version-2' },
  receipts: [
    PlatformFinanceReimbursementReceipt.make({
      ...reimbursementReceipt('receipt-3', 2300, 'Workshop'),
      submittedByEmail: 'grace@example.test',
      submittedByFirstName: 'Grace',
      submittedByLastName: 'Hopper',
      submittedByUserId: 'user-grace',
    }),
  ],
  submittedByEmail: 'grace@example.test',
  submittedByFirstName: 'Grace',
  submittedByLastName: 'Hopper',
  submittedByUserId: 'user-grace',
  totalAmount: 2300,
});

const normalizeText = (fixture: ComponentFixture<PlatformFinanceComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('PlatformFinanceComponent refund lifecycle table', () => {
  let queryClient: QueryClient;
  let acquiredQueryClient: QueryClient | undefined;

  const settleFinanceFixture = async (
    check: () => Promise<void>,
    cleanup: readonly ((() => Promise<void>) | (() => void))[],
  ) => {
    const failures: unknown[] = [];
    try {
      await check();
    } catch (error) {
      failures.push(error);
    }
    for (const release of cleanup) {
      try {
        await release();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(
        failures,
        'Finance assertions and fixture cleanup failed',
      );
  };

  beforeEach(async () => {
    acquiredQueryClient = undefined;
    loadApprovalDetail.mockImplementation(
      async (_targetTenantId: string, id: string) => ({
        receipt: approvalDetailReceipt(id),
        tenantContext,
      }),
    );
    loadApprovalQueue.mockResolvedValue({ groups: [], tenantContext });
    loadRecoveryQueue.mockResolvedValue({ claims: [], tenantContext });
    loadReimbursementQueue.mockResolvedValue({ groups: [], tenantContext });
    loadTransactions.mockResolvedValue({
      data: [],
      tenantContext,
      total: 0,
    });
    openDialog.mockReturnValue({ afterClosed: () => of(false) });
    recordReimbursementMutation.mockResolvedValue(recordedReimbursement);
    requeueRefundMutation.mockResolvedValue({
      mode: 'newGeneration',
      refundClaimId: 'refund-claim',
      transferRecovery: 'notTransfer',
    });
    reviewReceiptMutation.mockResolvedValue({
      id: 'reviewed-receipt',
      status: 'approved',
    });
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });

    acquiredQueryClient = queryClient;

    TestBed.overrideComponent(PlatformFinanceComponent, {
      add: { imports: [PlatformTenantPageHeaderStub] },
      remove: { imports: [PlatformTenantPageHeaderComponent] },
    });
    await TestBed.configureTestingModule({
      imports: [PlatformFinanceComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: LOCALE_ID, useValue: 'en-US' },
        {
          provide: TENANT_DATE_PIPE_TIMEZONE,
          useValue: 'Europe/Berlin',
        },
        {
          provide: MatDialog,
          useValue: { open: openDialog },
        },
        {
          provide: NotificationService,
          useValue: { showError: vi.fn(), showSuccess: vi.fn() },
        },
        {
          provide: PlatformFinanceOperations,
          useValue: {
            approvalDetail: (targetTenantId: string, id: string) => ({
              queryFn: () => loadApprovalDetail(targetTenantId, id),
              queryKey: createRpcQueryKey(
                ['platform', 'finance', 'receipts', 'approvalDetail'],
                {
                  input: { id, targetTenantId },
                  keyPrefix: 'rpc',
                  type: 'query',
                },
              ),
            }),
            approvalQueue: (targetTenantId: string) => ({
              queryFn: loadApprovalQueue,
              queryKey: createRpcQueryKey(
                ['platform', 'finance', 'receipts', 'approvalQueue'],
                { input: { targetTenantId }, keyPrefix: 'rpc', type: 'query' },
              ),
            }),
            financeFilter: () =>
              createRpcQueryFilter(['platform', 'finance'], {
                keyPrefix: 'rpc',
              }),
            recordReimbursement: () => ({
              meta: {
                rpc: {
                  path: [
                    'platform',
                    'finance',
                    'receipts',
                    'recordReimbursement',
                  ],
                },
              },
              mutationFn: recordReimbursementMutation,
              mutationKey: createRpcQueryKey<undefined>(
                ['platform', 'finance', 'receipts', 'recordReimbursement'],
                { keyPrefix: 'rpc', type: 'mutation' },
              ),
            }),
            recoveryQueue: (targetTenantId: string) => ({
              queryFn: loadRecoveryQueue,
              queryKey: createRpcQueryKey(
                ['platform', 'finance', 'refundClaims', 'recoveryQueue'],
                { input: { targetTenantId }, keyPrefix: 'rpc', type: 'query' },
              ),
            }),
            reimbursementQueue: (targetTenantId: string) => ({
              queryFn: loadReimbursementQueue,
              queryKey: createRpcQueryKey(
                ['platform', 'finance', 'receipts', 'reimbursementQueue'],
                { input: { targetTenantId }, keyPrefix: 'rpc', type: 'query' },
              ),
            }),
            requeueRefundClaim: () => ({
              meta: {
                rpc: {
                  path: ['platform', 'finance', 'refundClaims', 'requeue'],
                },
              },
              mutationFn: requeueRefundMutation,
              mutationKey: createRpcQueryKey<undefined>(
                ['platform', 'finance', 'refundClaims', 'requeue'],
                { keyPrefix: 'rpc', type: 'mutation' },
              ),
            }),
            reviewReceipt: () => ({
              meta: {
                rpc: { path: ['platform', 'finance', 'receipts', 'review'] },
              },
              mutationFn: reviewReceiptMutation,
              mutationKey: createRpcQueryKey<undefined>(
                ['platform', 'finance', 'receipts', 'review'],
                { keyPrefix: 'rpc', type: 'mutation' },
              ),
            }),
            transactions: (input: {
              limit: number;
              offset: number;
              targetTenantId: string;
            }) => ({
              queryFn: loadTransactions,
              queryKey: createRpcQueryKey(
                ['platform', 'finance', 'transactions', 'findMany'],
                { input, keyPrefix: 'rpc', type: 'query' },
              ),
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(async () => {
    const client = acquiredQueryClient;
    acquiredQueryClient = undefined;
    await settleFinanceFixture(
      () => Promise.resolve(),
      [
        () => client?.clear(),
        () => {
          vi.clearAllMocks();
        },
        () => {
          TestBed.resetTestingModule();
        },
      ],
    );
  });

  it('renders every refund lifecycle as restrained, safe table copy', async () => {
    type RefundLifecycleStatus =
      PlatformFinanceRefundLifecycleSummary['status'];
    const lifecycle = (status: RefundLifecycleStatus) =>
      PlatformFinanceRefundLifecycleSummary.make({
        attempts: 1,
        maxAttempts: 8,
        recoveryMode: status === 'needs-attention' ? 'resumeGeneration' : null,
        status,
      });
    const lifecycleStatuses: readonly RefundLifecycleStatus[] = [
      'action-required',
      'pending',
      'retrying',
      'succeeded',
      'needs-attention',
    ];
    loadTransactions.mockResolvedValue({
      data: lifecycleStatuses.map((status, index) => ({
        amount: -1200,
        appFee: null,
        comment: `Refund ${index + 1}`,
        createdAt: '2026-07-10T10:00:00.000Z',
        currency: 'EUR',
        id: `refund-${index + 1}`,
        method: 'stripe',
        refundLifecycle: lifecycle(status),
        status: 'pending',
        stripeFee: null,
        stripeRefundLastError: 'Provider secret must never render',
      })),
      tenantContext,
      total: lifecycleStatuses.length,
    });

    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      for (const label of [
        'Payment action needed',
        'Waiting',
        'Trying again',
        'Refunded',
        'Needs attention',
      ]) {
        expect(text).toContain(label);
      }
      expect(text).toContain(
        'Open Refunds needing attention to review what can be done.',
      );
      expect(text).toContain('Show latest status');
      expect(text).not.toContain('Provider secret must never render');
    });

    const checkStatusButton = [
      ...fixture.nativeElement.querySelectorAll('button'),
    ].find((button) => button.textContent?.includes('Show latest status'));
    expect(checkStatusButton).toBeInstanceOf(HTMLButtonElement);
    if (!(checkStatusButton instanceof HTMLButtonElement))
      throw new Error('Expected the latest-status button');
    checkStatusButton.click();

    await vi.waitFor(() => {
      expect(loadTransactions).toHaveBeenCalledTimes(2);
    });
  });

  it('keeps internal refund and transaction identifiers out of recovery copy', () => {
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-tenant-admin/platform-finance.component.html',
      ),
      'utf8',
    );

    expect(template).not.toContain('{{ claim.id }}');
    expect(template).not.toContain('{{ claim.eventRegistrationId }}');
    expect(template).not.toContain('{{ claim.sourceTransactionId }}');
    expect(template).not.toContain('{{ claim.transfer.id }}');
    expect(template).not.toContain('stripeRefundAttempts');
    expect(template).not.toContain('stripeRefundMaxAttempts');
  });

  it('distinguishes equal refund amounts with event, attendee, and target-local time', async () => {
    const recoveryClaim = (
      input: Pick<
        PlatformFinanceRefundRecoveryRecord,
        'attendeeFirstName' | 'attendeeLastName' | 'createdAt' | 'eventTitle'
      > & { id: string },
    ) =>
      PlatformFinanceRefundRecoveryRecord.make({
        amount: 1200,
        attendeeFirstName: input.attendeeFirstName,
        attendeeLastName: input.attendeeLastName,
        createdAt: input.createdAt,
        currency: 'EUR',
        eventId: 'event-1',
        eventRegistrationId: `registration-${input.id}`,
        eventTitle: input.eventTitle,
        id: input.id,
        lastError: 'Provider details must not appear in recovery copy',
        mode: 'newGeneration',
        sourceTransactionId: `source-${input.id}`,
        stripeRefundAttempts: 1,
        stripeRefundGeneration: 0,
        stripeRefundMaxAttempts: 8,
        stripeRefundStatus: 'failed',
        transfer: null,
        updatedAt: input.createdAt,
      });
    loadRecoveryQueue.mockResolvedValue({
      claims: [
        recoveryClaim({
          attendeeFirstName: 'Ada',
          attendeeLastName: 'Lovelace',
          createdAt: '2026-07-10T10:00:00.000Z',
          eventTitle: 'Welcome dinner',
          id: 'refund-internal-1',
        }),
        recoveryClaim({
          attendeeFirstName: 'Grace',
          attendeeLastName: 'Hopper',
          createdAt: '2026-07-10T11:00:00.000Z',
          eventTitle: 'City tour',
          id: 'refund-internal-2',
        }),
      ],
      tenantContext,
    });
    loadTransactions.mockResolvedValue({
      data: [],
      tenantContext,
      total: 0,
    });

    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();

    const tabs =
      await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatTabGroupHarness,
      );
    await tabs.selectTab({ label: 'Refunds needing attention' });

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain('Welcome dinner Ada Lovelace · €12.00');
      expect(text).toContain('Refund created 7/10/26, 8:00 PM');
      expect(text).toContain('City tour Grace Hopper · €12.00');
      expect(text).toContain('Refund created 7/10/26, 9:00 PM');
      expect(text).not.toContain('refund-internal-1');
      expect(text).not.toContain('Provider details must not appear');
    });
  });

  it('renders a Brisbane tenant instant in Brisbane when the host tenant is Berlin', async () => {
    loadTransactions.mockResolvedValue({
      data: [
        {
          amount: 1200,
          appFee: null,
          comment: 'Target timezone transaction',
          createdAt: '2026-07-15T14:30:00.000Z',
          currency: 'EUR',
          id: 'transaction-1',
          method: 'stripe',
          refundLifecycle: null,
          status: 'successful',
          stripeFee: null,
        },
      ],
      tenantContext,
      total: 1,
    });

    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain('7/16/26, 12:30 AM');
      expect(text).not.toContain('7/15/26, 4:30 PM');
    });
  });

  it('shows the selected reimbursement and leaves it unchanged when confirmation is cancelled', async () => {
    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    await fixture.whenStable();
    const component = fixture.componentInstance;

    await vi.waitFor(() => {
      expect(component['reimbursementQueueQuery'].isSuccess()).toBe(true);
    });
    component['chooseReimbursement'](reimbursementConfirmationGroup);
    component['reimbursementModel'].update((model) => ({
      ...model,
      reason: 'Paid by bank transfer',
    }));
    await fixture.whenStable();

    component['recordReimbursement'](new Event('submit'));

    await vi.waitFor(() => {
      expect(openDialog).toHaveBeenCalledWith(
        ReimbursementConfirmationDialogComponent,
        {
          data: {
            currency: 'EUR',
            payoutDestination: 'DE89370400440532013000',
            payoutMethod: 'Bank transfer',
            receiptCount: 2,
            recipient: 'Ada Lovelace',
            totalAmount: 2900,
          } satisfies ReimbursementConfirmationData,
          width: 'min(38rem, calc(100vw - 2rem))',
        },
      );
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(recordReimbursementMutation).not.toHaveBeenCalled();
    expect(component['selectedReimbursement']()?.group).toBe(
      reimbursementConfirmationGroup,
    );
    expect(component['reimbursementForm'].receiptIds().value()).toEqual([
      'receipt-1',
      'receipt-2',
    ]);
  });

  it('records the reviewed reimbursement only after explicit confirmation', async () => {
    openDialog.mockReturnValue({ afterClosed: () => of(true) });
    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    await fixture.whenStable();
    const component = fixture.componentInstance;

    await vi.waitFor(() => {
      expect(component['reimbursementQueueQuery'].isSuccess()).toBe(true);
    });
    let resolveRefresh: (() => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const pendingRefresh = new Promise<void>((resolve) => {
      resolveRefresh = resolve;
    });
    const refresh = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockReturnValue(pendingRefresh);
    component['chooseReimbursement'](reimbursementConfirmationGroup);
    component['reimbursementModel'].update((model) => ({
      ...model,
      reason: 'Paid by bank transfer',
    }));
    await fixture.whenStable();

    await settleFinanceFixture(async () => {
      component['recordReimbursement'](new Event('submit'));

      await vi.waitFor(() => {
        expect(recordReimbursementMutation).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledOnce();
      });
      expect(recordReimbursementMutation.mock.calls[0]?.[0]).toEqual({
        payoutType: 'iban',
        payoutVersion: 'iban-version-1',
        reason: 'Paid by bank transfer',
        receiptIds: ['receipt-1', 'receipt-2'],
        targetTenantId: 'tenant-1',
      });
      expect(refresh).toHaveBeenCalledWith(
        createRpcQueryFilter(['platform', 'finance'], { keyPrefix: 'rpc' }),
        { throwOnError: true },
      );
      expect(component['selectedReimbursement']()?.group).toBe(
        reimbursementConfirmationGroup,
      );
      expect(component['reimbursementForm'].receiptIds().value()).toEqual([
        'receipt-1',
        'receipt-2',
      ]);
      expect(component['financeActionBusy']()).toBe(true);
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).not.toHaveBeenCalled();
    }, [
      () => resolveRefresh?.(),
      () => pendingRefresh,
      () => {
        refresh.mockRestore();
      },
      () =>
        vi.waitFor(() => expect(component['financeActionBusy']()).toBe(false)),
    ]);
    await vi.waitFor(() => {
      expect(component['selectedReimbursement']()).toBeNull();
      expect(component['reimbursementForm'].receiptIds().value()).toEqual([]);
      expect(component['financeActionBusy']()).toBe(false);
    });
  });

  it('locks recipient selection and preserves a newer batch when an older write completes', async () => {
    let resolveReimbursement:
      ((result: ReimbursementResult) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const pendingReimbursement = new Promise<ReimbursementResult>((resolve) => {
      resolveReimbursement = resolve;
    });
    loadReimbursementQueue.mockResolvedValue({
      groups: [reimbursementConfirmationGroup, newerReimbursementGroup],
      tenantContext,
    });
    openDialog.mockReturnValue({ afterClosed: () => of(true) });
    recordReimbursementMutation.mockReturnValueOnce(pendingReimbursement);
    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    await fixture.whenStable();
    const component = fixture.componentInstance;

    await vi.waitFor(() => {
      expect(component['reimbursementQueueQuery'].isSuccess()).toBe(true);
    });
    const tabs =
      await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatTabGroupHarness,
      );
    await tabs.selectTab({ label: 'Reimbursements' });
    component['chooseReimbursement'](reimbursementConfirmationGroup);
    component['reimbursementModel'].update((model) => ({
      ...model,
      reason: 'Paid by bank transfer',
    }));
    await fixture.whenStable();

    component['recordReimbursement'](new Event('submit'));

    await vi.waitFor(() => {
      expect(recordReimbursementMutation).toHaveBeenCalledTimes(1);
      expect(component['reimbursementMutation'].isPending()).toBe(true);
    });
    const template = readFileSync(
      nodePath.join(
        process.cwd(),
        'src/app/global-admin/platform-tenant-admin/platform-finance.component.html',
      ),
      'utf8',
    );
    expect(template).toContain('[disabled]="financeActionsDisabled()"');

    component['chooseReimbursement'](newerReimbursementGroup);
    expect(component['selectedReimbursement']()?.group).toBe(
      reimbursementConfirmationGroup,
    );

    component['selectedReimbursement'].set({
      group: newerReimbursementGroup,
      timezone: tenantContext.timezone,
    });
    component['reimbursementModel'].set({
      payoutType: 'paypal',
      reason: 'Newer PayPal batch',
      receiptIds: ['receipt-3'],
    });
    if (!resolveReimbursement) {
      throw new Error('Expected the reimbursement mutation to be pending');
    }
    resolveReimbursement(recordedReimbursement);

    await vi.waitFor(() => {
      expect(component['reimbursementMutation'].isPending()).toBe(false);
    });
    expect(component['selectedReimbursement']()?.group).toBe(
      newerReimbursementGroup,
    );
    expect(component['reimbursementForm'].payoutType().value()).toBe('paypal');
    expect(component['reimbursementForm'].reason().value()).toBe(
      'Newer PayPal batch',
    );
    expect(component['reimbursementForm'].receiptIds().value()).toEqual([
      'receipt-3',
    ]);
  });

  it('locks batch edits while a reimbursement write is pending', async () => {
    let resolveReimbursement:
      ((result: ReimbursementResult) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const pendingReimbursement = new Promise<ReimbursementResult>((resolve) => {
      resolveReimbursement = resolve;
    });
    loadReimbursementQueue.mockResolvedValue({
      groups: [reimbursementConfirmationGroup],
      tenantContext,
    });
    openDialog.mockReturnValue({ afterClosed: () => of(true) });
    recordReimbursementMutation.mockReturnValueOnce(pendingReimbursement);
    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    await fixture.whenStable();
    const component = fixture.componentInstance;

    await vi.waitFor(() => {
      expect(component['reimbursementQueueQuery'].isSuccess()).toBe(true);
    });
    component['chooseReimbursement'](reimbursementConfirmationGroup);
    component['reimbursementModel'].update((model) => ({
      ...model,
      reason: 'Paid by bank transfer',
    }));
    await fixture.whenStable();
    const submittedModel = component['reimbursementModel']();

    component['recordReimbursement'](new Event('submit'));

    await vi.waitFor(() => {
      expect(component['reimbursementMutation'].isPending()).toBe(true);
    });
    expect(component['reimbursementForm'].payoutType().disabled()).toBe(true);
    expect(component['reimbursementForm'].reason().disabled()).toBe(true);
    expect(component['reimbursementForm'].receiptIds().disabled()).toBe(true);
    component['toggleReimbursementReceipt']('receipt-1', false);
    expect(component['reimbursementModel']()).toBe(submittedModel);
    expect(component['reimbursementForm'].receiptIds().value()).toEqual([
      'receipt-1',
      'receipt-2',
    ]);
    component['reimbursementModel'].set({
      ...submittedModel,
      reason: 'Stale edit that bypassed the disabled controls',
    });
    expect(component['reimbursementModel']()).not.toBe(submittedModel);

    if (!resolveReimbursement) {
      throw new Error('Expected the reimbursement mutation to be pending');
    }
    resolveReimbursement(recordedReimbursement);

    await vi.waitFor(() => {
      expect(component['reimbursementMutation'].isPending()).toBe(false);
      expect(component['selectedReimbursement']()).toBeNull();
      expect(component['reimbursementForm'].receiptIds().value()).toEqual([]);
    });
  });

  it('ignores an in-flight receipt detail after the tenant changes', async () => {
    interface ApprovalDetailResult {
      receipt: PlatformFinanceReceiptApprovalDetailRecord;
      tenantContext: PlatformFinanceTenantContext;
    }
    let resolveDetail: ((detail: ApprovalDetailResult) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const pendingDetail = new Promise<ApprovalDetailResult>((resolve) => {
      resolveDetail = resolve;
    });
    loadApprovalDetail.mockImplementationOnce(() => pendingDetail);

    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const detailPromise = component['chooseReceipt'](
      approvalQueueReceipt('stale-receipt'),
    );

    await vi.waitFor(() => {
      expect(component['receiptDetailPending']()).toBe(true);
    });

    fixture.componentRef.setInput('tenantId', 'tenant-2');
    fixture.detectChanges();
    expect(component['receiptDetailPending']()).toBe(false);

    if (!resolveDetail) {
      throw new Error('Expected the receipt detail request to be pending');
    }
    resolveDetail({
      receipt: approvalDetailReceipt('stale-receipt'),
      tenantContext,
    });
    await detailPromise;

    expect(component['selectedReceipt']()).toBeNull();
    expect(component['reviewForm'].id().value()).toBe('');
  });

  it('clears tenant-scoped selections and form models when the tenant changes', async () => {
    const receipt = approvalQueueReceipt('tenant-a-receipt');
    const reimbursementGroup = PlatformFinanceReimbursementGroup.make({
      currency: 'EUR',
      payout: {
        iban: 'DE89370400440532013000',
        paypalEmail: 'tenant-a-participant@example.test',
      },
      payoutVersions: { iban: 'tenant-a-payout', paypal: null },
      receipts: [
        PlatformFinanceReimbursementReceipt.make({
          ...receipt,
          eventStart: '2026-07-20T10:00:00.000Z',
          eventTitle: 'Tenant A event',
          status: 'approved',
        }),
      ],
      submittedByEmail: receipt.submittedByEmail,
      submittedByFirstName: receipt.submittedByFirstName,
      submittedByLastName: receipt.submittedByLastName,
      submittedByUserId: receipt.submittedByUserId,
      totalAmount: receipt.totalAmount,
    });
    const refundClaim = PlatformFinanceRefundRecoveryRecord.make({
      amount: 1190,
      attendeeFirstName: 'Tenant A',
      attendeeLastName: 'Participant',
      createdAt: '2026-07-10T10:00:00.000Z',
      currency: 'EUR',
      eventId: receipt.eventId,
      eventRegistrationId: 'tenant-a-registration',
      eventTitle: 'Tenant A event',
      id: 'tenant-a-refund-claim',
      lastError: null,
      mode: 'newGeneration',
      sourceTransactionId: 'tenant-a-transaction',
      stripeRefundAttempts: 1,
      stripeRefundGeneration: 0,
      stripeRefundMaxAttempts: 8,
      stripeRefundStatus: 'failed',
      transfer: null,
      updatedAt: '2026-07-10T10:05:00.000Z',
    });

    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();
    const component = fixture.componentInstance;

    await vi.waitFor(() => {
      expect(component['reimbursementQueueQuery'].isSuccess()).toBe(true);
    });

    await component['chooseReceipt'](receipt);
    component['chooseReimbursement'](reimbursementGroup);
    component['chooseRefundClaim'](refundClaim);
    component['reviewModel'].update((model) => ({
      ...model,
      reason: 'Tenant A review reason',
    }));
    component['reimbursementModel'].update((model) => ({
      ...model,
      reason: 'Tenant A reimbursement reason',
    }));
    component['refundRecoveryModel'].update((model) => ({
      ...model,
      reason: 'Tenant A refund reason',
    }));
    component['transactionPageIndex'].set(4);

    expect(component['selectedReceipt']()).not.toBeNull();
    expect(loadApprovalDetail).toHaveBeenCalledWith(
      'tenant-1',
      'tenant-a-receipt',
    );
    expect(component['selectedReceipt']()?.receipt.previewImageUrl).toBe(
      'https://example.test/tenant-a-receipt.pdf',
    );
    expect(component['selectedReimbursement']()).not.toBeNull();
    expect(component['selectedRefundClaim']()).not.toBeNull();

    fixture.componentRef.setInput('tenantId', 'tenant-2');
    fixture.detectChanges();

    expect(component['selectedReceipt']()).toBeNull();
    expect(component['reviewForm'].id().value()).toBe('');
    expect(component['reviewForm'].reason().value()).toBe('');

    expect(component['selectedReimbursement']()).toBeNull();
    expect(component['reimbursementForm'].payoutType().value()).toBe('');
    expect(component['reimbursementForm'].reason().value()).toBe('');
    expect(component['reimbursementForm'].receiptIds().value()).toEqual([]);

    expect(component['selectedRefundClaim']()).toBeNull();
    expect(component['refundRecoveryForm'].refundClaimId().value()).toBe('');
    expect(component['refundRecoveryForm'].reason().value()).toBe('');
    expect(component['transactionPageIndex']()).toBe(0);
  });

  const actions = [
    {
      action: 'review',
      mutation: reviewReceiptMutation,
      path: ['platform', 'finance', 'receipts', 'review'],
      payload: {
        alcoholAmount: 0,
        depositAmount: 0,
        hasAlcohol: false,
        hasDeposit: false,
        id: 'reviewed-receipt',
        purchaseCountry: 'DE',
        reason: 'Checked receipt evidence',
        receiptDate: '2026-07-09',
        rejectionReason: null,
        status: 'approved',
        targetTenantId: 'tenant-1',
        taxAmount: 190,
        totalAmount: 1190,
      },
      summary: 'Receipt approved',
    },
    {
      action: 'reimbursement',
      mutation: recordReimbursementMutation,
      path: ['platform', 'finance', 'receipts', 'recordReimbursement'],
      payload: {
        payoutType: 'iban',
        payoutVersion: 'iban-version-1',
        reason: 'Paid by bank transfer',
        receiptIds: ['receipt-1', 'receipt-2'],
        targetTenantId: 'tenant-1',
      },
      summary: 'Recorded reimbursement for 2 receipts',
    },
    {
      action: 'refund',
      mutation: requeueRefundMutation,
      path: ['platform', 'finance', 'refundClaims', 'requeue'],
      payload: {
        reason: 'Checked refund eligibility',
        refundClaimId: 'refund-claim',
        targetTenantId: 'tenant-1',
      },
      summary: 'The refund will be tried again',
    },
  ] as const;
  type FinanceAction = (typeof actions)[number]['action'];

  const startAction = (
    component: PlatformFinanceComponent,
    action: FinanceAction,
  ) => {
    switch (action) {
      case 'refund': {
        component['requeueRefundClaim'](new Event('submit'));
        break;
      }
      case 'reimbursement': {
        component['recordReimbursement'](new Event('submit'));
        break;
      }
      case 'review': {
        component['reviewReceipt'](new Event('submit'));
        break;
      }
    }
  };

  const selections = (component: PlatformFinanceComponent) => ({
    receipt: component['selectedReceipt'](),
    refund: component['selectedRefundClaim'](),
    refundModel: component['refundRecoveryModel'](),
    reimbursement: component['selectedReimbursement'](),
    reimbursementModel: component['reimbursementModel'](),
    reviewModel: component['reviewModel'](),
  });

  const held = <T>() => {
    let complete: ((value: T) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const promise = new Promise<T>((resolve) => {
      complete = resolve;
    });
    return {
      promise,
      resolve(value: T) {
        if (!complete) throw new Error('Expected a registered completion');
        complete(value);
      },
    };
  };

  it.each(['success', 'rejection'] as const)(
    'settles a held receipt detail %s without updating a destroyed page',
    async (outcome) => {
      const fixture = TestBed.createComponent(PlatformFinanceComponent);
      const component = fixture.componentInstance;
      const notifications = TestBed.inject(NotificationService);
      const detailOptions = TestBed.inject(
        PlatformFinanceOperations,
      ).approvalDetail('tenant-1', 'destroyed-receipt');
      const detail = {
        receipt: approvalDetailReceipt('destroyed-receipt'),
        tenantContext,
      };
      const failure = new Error('Held receipt detail failed after destruction');
      const gate = held<undefined>();
      const nativeRead = gate.promise.then(() => {
        if (outcome === 'rejection') throw failure;
        return detail;
      });
      let nativeSettled = false;
      const nativeSettlement = nativeRead.then(
        () => {
          nativeSettled = true;
        },
        () => {
          nativeSettled = true;
        },
      );
      loadApprovalDetail.mockReturnValueOnce(nativeRead);
      let detailOperation: Promise<void> | undefined;
      let detailSettlement: Promise<void> | undefined;
      let detailFailure: undefined | { cause: unknown };

      await settleFinanceFixture(async () => {
        fixture.componentRef.setInput('tenantId', 'tenant-1');
        fixture.detectChanges();
        detailOperation = component['chooseReceipt'](
          approvalQueueReceipt('destroyed-receipt'),
        );
        detailSettlement = detailOperation.then(
          () => {
            // The operation settled without an unexpected rejection.
          },
          (error: unknown) => {
            detailFailure = { cause: error };
          },
        );
        await vi.waitFor(() => {
          expect(loadApprovalDetail).toHaveBeenCalledExactlyOnceWith(
            'tenant-1',
            'destroyed-receipt',
          );
          expect(component['receiptDetailPending']()).toBe(true);
        });

        const cachedDetail = queryClient.getQueryCache().find({
          exact: true,
          queryKey: detailOptions.queryKey,
        });
        if (!cachedDetail) {
          throw new Error('Expected the held receipt detail in the cache');
        }
        const reviewBeforeDestruction = component['reviewModel']();
        expect(nativeSettled).toBe(false);
        fixture.destroy();
        expect(fixture.componentRef.hostView.destroyed).toBe(true);
        expect(nativeSettled).toBe(false);
        expect(cachedDetail.state.fetchStatus).toBe('fetching');

        gate.resolve(undefined);
        await detailOperation;
        await nativeSettlement;

        expect(nativeSettled).toBe(true);
        expect(cachedDetail.state.fetchStatus).toBe('idle');
        if (outcome === 'success') {
          expect(cachedDetail.state.status).toBe('success');
          expect(cachedDetail.state.data).toEqual(detail);
        } else {
          expect(cachedDetail.state.status).toBe('error');
          expect(cachedDetail.state.error).toBe(failure);
        }
        expect(component['selectedReceipt']()).toBeNull();
        expect(component['reviewModel']()).toBe(reviewBeforeDestruction);
        expect(notifications.showError).not.toHaveBeenCalled();
        expect(notifications.showSuccess).not.toHaveBeenCalled();
        expect(reviewReceiptMutation).not.toHaveBeenCalled();
        expect(recordReimbursementMutation).not.toHaveBeenCalled();
        expect(requeueRefundMutation).not.toHaveBeenCalled();
      }, [
        () => gate.resolve(undefined),
        async () => {
          await nativeSettlement;
        },
        async () => {
          await detailSettlement;
          if (detailFailure) throw detailFailure.cause;
        },
        () => {
          loadApprovalDetail.mockReset();
        },
        () => fixture.destroy(),
      ]);
    },
  );

  const prepareFinance = async () => {
    openDialog.mockReturnValue({ afterClosed: () => of(true) });
    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    await fixture.whenStable();
    const component = fixture.componentInstance;
    await vi.waitFor(() => {
      expect(component['approvalQueueQuery'].isSuccess()).toBe(true);
      expect(component['reimbursementQueueQuery'].isSuccess()).toBe(true);
      expect(component['recoveryQueueQuery'].isSuccess()).toBe(true);
      expect(component['transactionsQuery'].isSuccess()).toBe(true);
      expect(queryClient.isFetching()).toBe(0);
    });
    await component['chooseReceipt'](approvalQueueReceipt('reviewed-receipt'));
    component['reviewModel'].update((model) => ({
      ...model,
      reason: 'Checked receipt evidence',
    }));
    component['chooseReimbursement'](reimbursementConfirmationGroup);
    component['reimbursementModel'].update((model) => ({
      ...model,
      reason: 'Paid by bank transfer',
    }));
    component['chooseRefundClaim'](
      PlatformFinanceRefundRecoveryRecord.make({
        amount: 1190,
        attendeeFirstName: 'Pat',
        attendeeLastName: 'Example',
        createdAt: '2026-07-10T10:00:00.000Z',
        currency: 'EUR',
        eventId: 'event-refund',
        eventRegistrationId: 'registration-refund',
        eventTitle: 'Refund event',
        id: 'refund-claim',
        lastError: null,
        mode: 'newGeneration',
        sourceTransactionId: 'source-transaction',
        stripeRefundAttempts: 1,
        stripeRefundGeneration: 0,
        stripeRefundMaxAttempts: 8,
        stripeRefundStatus: 'failed',
        transfer: null,
        updatedAt: '2026-07-10T10:05:00.000Z',
      }),
    );
    component['refundRecoveryModel'].update((model) => ({
      ...model,
      reason: 'Checked refund eligibility',
    }));
    await fixture.whenStable();
    expect(component['reviewForm']().invalid()).toBe(false);
    expect(component['reimbursementForm']().invalid()).toBe(false);
    expect(component['refundRecoveryForm']().invalid()).toBe(false);
    return { component, fixture };
  };

  it.each(actions)(
    'holds $action after the first failed read until its active sibling settles, then checks current state without repeating the write',
    async ({ action, mutation, path, payload, summary }) => {
      const { component, fixture } = await prepareFinance();
      const selected = selections(component);
      const transactionRead = held<{
        data: never[];
        tenantContext: PlatformFinanceTenantContext;
        total: number;
      }>();
      loadApprovalQueue.mockRejectedValueOnce(
        new Error('Approval read failed'),
      );
      loadTransactions.mockReturnValueOnce(transactionRead.promise);
      await settleFinanceFixture(async () => {
        startAction(component, action);
        await vi.waitFor(() => {
          expect(mutation).toHaveBeenCalledTimes(1);
          expect(component['approvalQueueQuery'].isError()).toBe(true);
          expect(component['transactionsQuery'].isFetching()).toBe(true);
        });
        expect(mutation).toHaveBeenCalledExactlyOnceWith(payload, {
          client: queryClient,
          meta: { rpc: { path } },
          mutationKey: createRpcQueryKey<undefined>(path, {
            keyPrefix: 'rpc',
            type: 'mutation',
          }),
        });
        expect(component['financeActionBusy']()).toBe(true);
        expect(component['financeOutcome']()).toBeNull();
        expect(selections(component)).toEqual(selected);
        expect(component['reviewForm'].reason().disabled()).toBe(true);
        expect(component['reimbursementForm'].reason().disabled()).toBe(true);
        expect(component['refundRecoveryForm'].reason().disabled()).toBe(true);
        for (const candidate of actions)
          startAction(component, candidate.action);
        component['chooseReimbursement'](newerReimbursementGroup);
        component['toggleReimbursementReceipt']('receipt-1', false);
        expect(selections(component)).toEqual(selected);
        expect(
          TestBed.inject(NotificationService).showSuccess,
        ).not.toHaveBeenCalled();
      }, [
        () => transactionRead.resolve({ data: [], tenantContext, total: 0 }),
        () => transactionRead.promise,
        () =>
          vi.waitFor(() =>
            expect(component['financeActionBusy']()).toBe(false),
          ),
      ]);
      await vi.waitFor(() => {
        expect(component['financeActionBusy']()).toBe(false);
        expect(component['financeOutcome']()).toEqual({
          kind: 'confirmed',
          readState: 'failed',
          summary,
        });
      });
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(summary);
      expect(normalizeText(fixture)).toContain(
        'The latest finance information could not be loaded.',
      );
      expect(normalizeText(fixture)).toContain(
        'This only loads information; it does not repeat the previous action.',
      );
      expect(component['financeActionsDisabled']()).toBe(true);
      expect(selections(component)).toEqual(selected);
      for (const candidate of actions) {
        startAction(component, candidate.action);
        expect(candidate.mutation).toHaveBeenCalledTimes(
          candidate.action === action ? 1 : 0,
        );
      }
      await component['showLatestFinance']();
      expect(component['financeOutcome']()).toBeNull();
      expect(component['financeActionsDisabled']()).toBe(false);
      expect(component['selectedReceipt']()).toBeNull();
      expect(component['selectedReimbursement']()).toBeNull();
      expect(component['selectedRefundClaim']()).toBeNull();
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).toHaveBeenCalledExactlyOnceWith(
        'Latest finance information loaded. Select a record to continue.',
      );
      for (const candidate of actions) {
        expect(candidate.mutation).toHaveBeenCalledTimes(
          candidate.action === action ? 1 : 0,
        );
      }
    },
  );

  it.each(
    actions.flatMap((action) => [
      {
        ...action,
        error: new Error('Response interrupted with private details'),
        fault: 'transport',
      },
      {
        ...action,
        error: new RpcInternalServerError({
          message: 'Response interrupted with private details',
        }),
        fault: 'internal',
      },
    ]),
  )(
    'keeps an unknown $fault $action response locked with the original selection and reason until an explicit read',
    async ({ action, error, mutation }) => {
      const { component, fixture } = await prepareFinance();
      const selected = selections(component);
      mutation.mockRejectedValueOnce(error);
      startAction(component, action);
      await vi.waitFor(() => {
        expect(mutation).toHaveBeenCalledTimes(1);
        expect(component['financeOutcome']()?.kind).toBe('unknown');
        expect(component['financeActionBusy']()).toBe(false);
      });
      fixture.detectChanges();
      expect(component['financeOutcome']()?.readState).toBe('unchecked');
      expect(normalizeText(fixture)).toContain("We couldn't confirm whether");
      expect(normalizeText(fixture)).toContain(
        'Your selection and reason are still here.',
      );
      expect(normalizeText(fixture)).not.toContain('private details');
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).not.toHaveBeenCalled();
      expect(
        TestBed.inject(NotificationService).showError,
      ).not.toHaveBeenCalled();
      expect(selections(component)).toEqual(selected);
      for (const candidate of actions) startAction(component, candidate.action);
      expect(mutation).toHaveBeenCalledTimes(1);
      loadApprovalQueue.mockRejectedValueOnce(new Error('Read unavailable'));
      await component['showLatestFinance']();
      expect(component['financeOutcome']()?.kind).toBe('unknown');
      expect(component['financeOutcome']()?.readState).toBe('failed');
      expect(component['financeActionsDisabled']()).toBe(true);
      expect(selections(component)).toEqual(selected);
      await component['showLatestFinance']();
      expect(component['financeOutcome']()).toBeNull();
      expect(component['financeActionsDisabled']()).toBe(false);
      for (const candidate of actions) {
        expect(candidate.mutation).toHaveBeenCalledTimes(
          candidate.action === action ? 1 : 0,
        );
      }
    },
  );

  it.each(actions)(
    'keeps a typed $action denial correctable without clearing its values',
    async ({ action, mutation }) => {
      const { component } = await prepareFinance();
      const selected = selections(component);
      mutation.mockRejectedValueOnce(
        new RpcBadRequestError({
          message: 'This record changed. Check its current status.',
        }),
      );
      startAction(component, action);
      await vi.waitFor(() => {
        expect(mutation).toHaveBeenCalledTimes(1);
        expect(component['financeActionBusy']()).toBe(false);
        expect(
          TestBed.inject(NotificationService).showError,
        ).toHaveBeenCalledExactlyOnceWith(
          'This record changed. Check its current status.',
        );
      });
      expect(component['financeOutcome']()).toBeNull();
      expect(component['financeActionsDisabled']()).toBe(false);
      expect(selections(component)).toEqual(selected);
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).not.toHaveBeenCalled();
    },
  );

  it.each(
    actions.flatMap((action) => [
      {
        ...action,
        error: new RpcUnauthorizedError({
          message: 'Private authorization context',
        }),
        message:
          'Sign in again, then check the latest finance information before continuing.',
        tag: 'unauthorized',
      },
      {
        ...action,
        error: new RpcForbiddenError({
          message: 'Private authorization context',
          permission: 'private-permission',
        }),
        message:
          'Your account does not have access to this finance action. Ask an administrator to check your access.',
        tag: 'forbidden',
      },
    ]),
  )(
    'shows safe $tag guidance for $action without treating the denial as an uncertain write',
    async ({ action, error, message, mutation }) => {
      const { component } = await prepareFinance();
      const selected = selections(component);
      mutation.mockRejectedValueOnce(error);
      startAction(component, action);
      await vi.waitFor(() => {
        expect(
          TestBed.inject(NotificationService).showError,
        ).toHaveBeenCalledExactlyOnceWith(message);
        expect(component['financeActionBusy']()).toBe(false);
      });
      expect(component['financeOutcome']()).toBeNull();
      expect(component['financeActionsDisabled']()).toBe(false);
      expect(selections(component)).toEqual(selected);
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).not.toHaveBeenCalled();
    },
  );

  it('owns all finance controls while reimbursement confirmation is open and releases them on cancellation', async () => {
    const { component } = await prepareFinance();
    const selected = selections(component);
    const confirmation = new Subject<boolean>();
    openDialog.mockReturnValueOnce({ afterClosed: () => confirmation });
    await settleFinanceFixture(async () => {
      startAction(component, 'reimbursement');
      await vi.waitFor(() =>
        expect(component['financePhase']()).toBe('confirming'),
      );
      for (const candidate of actions) startAction(component, candidate.action);
      component['chooseReimbursement'](newerReimbursementGroup);
      component['toggleReimbursementReceipt']('receipt-1', false);
      expect(component['reimbursementForm'].payoutType().disabled()).toBe(true);
      expect(component['reviewForm'].reason().disabled()).toBe(true);
      expect(component['refundRecoveryForm'].reason().disabled()).toBe(true);
      expect(selections(component)).toEqual(selected);
      expect(openDialog).toHaveBeenCalledTimes(1);
      for (const candidate of actions)
        expect(candidate.mutation).not.toHaveBeenCalled();
    }, [
      () => confirmation.next(false),
      () => confirmation.complete(),
      () =>
        vi.waitFor(() => expect(component['financeActionBusy']()).toBe(false)),
    ]);
    await vi.waitFor(() =>
      expect(component['financeActionBusy']()).toBe(false),
    );
    expect(component['financeOutcome']()).toBeNull();
    expect(component['financeActionsDisabled']()).toBe(false);
    expect(selections(component)).toEqual(selected);
  });

  it('does not await inactive work or start disabled and static reads during a successful finance update', async () => {
    const { component } = await prepareFinance();
    const inactive = held<string>();
    const disabledRead = vi.fn(async () => 'disabled');
    const staticRead = vi.fn(async () => 'static');
    const inactiveRead = queryClient.fetchQuery({
      queryFn: () => inactive.promise,
      queryKey: createRpcQueryKey(
        ['platform', 'finance', 'transactions', 'findMany'],
        {
          input: { targetTenantId: 'tenant-1', view: 'inactive' },
          keyPrefix: 'rpc',
          type: 'query',
        },
      ),
    });
    const inactiveResult = inactiveRead.then(
      () => ({ status: 'fulfilled' as const }),
      (error: unknown) => ({ error, status: 'rejected' as const }),
    );
    const disabledObserver = new QueryObserver(queryClient, {
      enabled: false,
      queryFn: disabledRead,
      queryKey: createRpcQueryKey(
        ['platform', 'finance', 'transactions', 'findMany'],
        {
          input: { targetTenantId: 'tenant-1', view: 'disabled' },
          keyPrefix: 'rpc',
          type: 'query',
        },
      ),
    });
    const staticObserver = new QueryObserver(queryClient, {
      initialData: 'static',
      queryFn: staticRead,
      queryKey: createRpcQueryKey(
        ['platform', 'finance', 'transactions', 'findMany'],
        {
          input: { targetTenantId: 'tenant-1', view: 'static' },
          keyPrefix: 'rpc',
          type: 'query',
        },
      ),
      staleTime: 'static',
    });
    const unsubscribeDisabled = disabledObserver.subscribe(() => {
      // Keep this observer attached to verify the disabled query is excluded.
    });
    const unsubscribeStatic = staticObserver.subscribe(() => {
      // Keep this observer attached to verify the static query is excluded.
    });
    await settleFinanceFixture(async () => {
      startAction(component, 'review');
      await vi.waitFor(() => {
        expect(reviewReceiptMutation).toHaveBeenCalledTimes(1);
        expect(component['financeActionBusy']()).toBe(false);
        expect(component['selectedReceipt']()).toBeNull();
      });
      expect(
        queryClient.getQueryState(
          createRpcQueryKey(
            ['platform', 'finance', 'transactions', 'findMany'],
            {
              input: { targetTenantId: 'tenant-1', view: 'inactive' },
              keyPrefix: 'rpc',
              type: 'query',
            },
          ),
        )?.fetchStatus,
      ).toBe('fetching');
      expect(disabledRead).not.toHaveBeenCalled();
      expect(staticRead).not.toHaveBeenCalled();
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).toHaveBeenCalledExactlyOnceWith('Receipt approved');
      expect(component['financeOutcome']()).toBeNull();
      expect(reviewReceiptMutation.mock.calls[0]?.[0]).toEqual({
        alcoholAmount: 0,
        depositAmount: 0,
        hasAlcohol: false,
        hasDeposit: false,
        id: 'reviewed-receipt',
        purchaseCountry: 'DE',
        reason: 'Checked receipt evidence',
        receiptDate: '2026-07-09',
        rejectionReason: null,
        status: 'approved',
        targetTenantId: 'tenant-1',
        taxAmount: 190,
        totalAmount: 1190,
      });
    }, [
      () => inactive.resolve('done'),
      async () => {
        const result = await inactiveResult;
        if (result.status === 'rejected') throw result.error;
      },
      unsubscribeDisabled,
      unsubscribeStatic,
      () =>
        vi.waitFor(() => expect(component['financeActionBusy']()).toBe(false)),
    ]);
  });

  it('retains a confirmed reimbursement while its follow-up reads are paused and only unlocks after an explicit successful read', async () => {
    const { component, fixture } = await prepareFinance();
    const selected = selections(component);
    const originallyOnline = onlineManager.isOnline();
    recordReimbursementMutation.mockImplementationOnce(async () => {
      onlineManager.setOnline(false);
      return recordedReimbursement;
    });
    await settleFinanceFixture(async () => {
      startAction(component, 'reimbursement');
      await vi.waitFor(() => {
        expect(component['financeActionBusy']()).toBe(false);
        expect(component['financeOutcome']()?.readState).toBe('paused');
      });
      expect(component['financeOutcome']()?.kind).toBe('confirmed');
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'The latest finance information is waiting for a connection.',
      );
      expect(normalizeText(fixture)).not.toContain(
        'The latest finance information could not be loaded.',
      );
      expect(component['financeActionsDisabled']()).toBe(true);
      expect(selections(component)).toEqual(selected);
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).not.toHaveBeenCalled();
      for (const candidate of actions) startAction(component, candidate.action);
      expect(recordReimbursementMutation).toHaveBeenCalledTimes(1);
    }, [
      () => onlineManager.setOnline(true),
      () =>
        vi.waitFor(() => {
          const reads = queryClient.getQueryCache().findAll(
            createRpcQueryFilter(['platform', 'finance'], {
              keyPrefix: 'rpc',
            }),
          );
          expect(
            reads.every((query) => query.state.fetchStatus === 'idle'),
          ).toBe(true);
        }),
      () => onlineManager.setOnline(originallyOnline),
      () =>
        vi.waitFor(() => expect(component['financeActionBusy']()).toBe(false)),
    ]);
    expect(component['financeOutcome']()?.readState).toBe('paused');
    await component['showLatestFinance']();
    expect(component['financeOutcome']()).toBeNull();
    expect(component['selectedReimbursement']()).toBeNull();
    expect(recordReimbursementMutation).toHaveBeenCalledTimes(1);
  });

  it('keeps the outcome when an admitted read is cancelled instead of accepting stale cached data', async () => {
    const { component } = await prepareFinance();
    const selected = selections(component);
    const transactionRead = held<{
      data: never[];
      tenantContext: PlatformFinanceTenantContext;
      total: number;
    }>();
    loadTransactions.mockReturnValueOnce(transactionRead.promise);
    await settleFinanceFixture(async () => {
      startAction(component, 'review');
      await vi.waitFor(() =>
        expect(component['transactionsQuery'].isFetching()).toBe(true),
      );
      await queryClient.cancelQueries({
        queryKey: createRpcQueryKey(
          ['platform', 'finance', 'transactions', 'findMany'],
          {
            input: { limit: 100, offset: 0, targetTenantId: 'tenant-1' },
            keyPrefix: 'rpc',
            type: 'query',
          },
        ),
      });
      await vi.waitFor(() => {
        expect(component['financeActionBusy']()).toBe(false);
        expect(component['financeOutcome']()?.readState).toBe('failed');
      });
      expect(component['financeOutcome']()?.kind).toBe('confirmed');
      expect(selections(component)).toEqual(selected);
      expect(component['financeActionsDisabled']()).toBe(true);
      expect(
        TestBed.inject(NotificationService).showSuccess,
      ).not.toHaveBeenCalled();
    }, [
      () => transactionRead.resolve({ data: [], tenantContext, total: 0 }),
      () => transactionRead.promise,
      () =>
        vi.waitFor(() => expect(component['financeActionBusy']()).toBe(false)),
    ]);
    await component['showLatestFinance']();
    expect(component['financeOutcome']()).toBeNull();
    expect(reviewReceiptMutation).toHaveBeenCalledTimes(1);
  });

  it('holds an old tenant action through its owned read and does not carry its outcome into the new tenant', async () => {
    const { component, fixture } = await prepareFinance();
    const transactionRead = held<{
      data: never[];
      tenantContext: PlatformFinanceTenantContext;
      total: number;
    }>();
    loadTransactions.mockReturnValueOnce(transactionRead.promise);
    await settleFinanceFixture(async () => {
      startAction(component, 'refund');
      await vi.waitFor(() => {
        expect(requeueRefundMutation).toHaveBeenCalledTimes(1);
        expect(component['transactionsQuery'].isFetching()).toBe(true);
      });
      const nextTenantContext = PlatformFinanceTenantContext.make({
        ...tenantContext,
        targetTenantId: 'tenant-2',
      });
      loadApprovalQueue.mockResolvedValue({
        groups: [],
        tenantContext: nextTenantContext,
      });
      loadReimbursementQueue.mockResolvedValue({
        groups: [],
        tenantContext: nextTenantContext,
      });
      loadRecoveryQueue.mockResolvedValue({
        claims: [],
        tenantContext: nextTenantContext,
      });
      loadTransactions.mockResolvedValue({
        data: [],
        tenantContext: nextTenantContext,
        total: 0,
      });
      fixture.componentRef.setInput('tenantId', 'tenant-2');
      fixture.detectChanges();
      expect(component['selectedReceipt']()).toBeNull();
      expect(component['selectedReimbursement']()).toBeNull();
      expect(component['selectedRefundClaim']()).toBeNull();
      expect(component['financeActionBusy']()).toBe(true);
      expect(component['financeOutcome']()).toBeNull();
      for (const candidate of actions) startAction(component, candidate.action);
      expect(requeueRefundMutation.mock.calls[0]?.[0]).toEqual({
        reason: 'Checked refund eligibility',
        refundClaimId: 'refund-claim',
        targetTenantId: 'tenant-1',
      });
    }, [
      () => transactionRead.resolve({ data: [], tenantContext, total: 0 }),
      () => transactionRead.promise,
      () =>
        vi.waitFor(() => expect(component['financeActionBusy']()).toBe(false)),
    ]);
    await vi.waitFor(() =>
      expect(component['financeActionBusy']()).toBe(false),
    );
    await vi.waitFor(() => {
      expect(
        component['transactionsQuery'].data()?.tenantContext.targetTenantId,
      ).toBe('tenant-2');
    });
    expect(component['financeOutcome']()).toBeNull();
    expect(component['refundRecoveryModel']()).toEqual({
      reason: '',
      refundClaimId: '',
    });
    expect(
      TestBed.inject(NotificationService).showSuccess,
    ).not.toHaveBeenCalled();
    expect(
      TestBed.inject(NotificationService).showError,
    ).not.toHaveBeenCalled();
    expect(requeueRefundMutation).toHaveBeenCalledTimes(1);
    expect(reviewReceiptMutation).not.toHaveBeenCalled();
    expect(recordReimbursementMutation).not.toHaveBeenCalled();
  });
});
