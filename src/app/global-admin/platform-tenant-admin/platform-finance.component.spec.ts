import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { Component, input, LOCALE_ID } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatTabGroupHarness } from '@angular/material/tabs/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import nodePath from 'node:path';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
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
  PlatformFinanceComponent,
  PlatformFinanceOperations,
  platformReceiptEvidenceUnavailableNotice,
  platformReceiptReviewDisabled,
  platformRefundLifecycleCopy,
  platformTransactionMethodLabel,
  platformTransactionStatusLabel,
} from './platform-finance.component';
import {
  type PlatformReimbursementConfirmationData,
  PlatformReimbursementConfirmationDialogComponent,
} from './platform-reimbursement-confirmation-dialog.component';
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
      'Receipt evidence is unavailable. Approval is disabled until the uploaded file can be verified. You can still reject this receipt.',
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
    expect(platformTransactionStatusLabel('pending')).toBe('Pending');
    expect(platformTransactionStatusLabel('successful')).toBe('Successful');

    expect(platformTransactionMethodLabel('cash')).toBe('Cash');
    expect(platformTransactionMethodLabel('paypal')).toBe('PayPal');
    expect(platformTransactionMethodLabel('stripe')).toBe('Stripe');
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
        'Automatic refund processing stopped. Open Refund recovery to review the safe next step.',
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
        'Evorto cannot safely retry this refund. Compare it with the connected Stripe account before making a manual change.',
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

    expect(scheduled.detail).toContain(
      'Evorto will keep checking automatically',
    );
    expect(scheduled.detail).toContain('connected Stripe account');
    expect(scheduled.detail).not.toContain('provider-side');
    expect(scheduled.detail).not.toContain('open Refund recovery');
    expect(stopped.detail).toContain('open Refund recovery');
  });

  it('distinguishes all non-attention states', () => {
    const expectedLabels: readonly (readonly [
      PlatformFinanceRefundLifecycleSummary['status'],
      string,
    ])[] = [
      ['action-required', 'Action required in Stripe'],
      ['pending', 'Pending'],
      ['retrying', 'Retrying'],
      ['succeeded', 'Succeeded'],
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
      'Required. This reason is saved with the recovery action.',
    );
    expect(template).toContain('Retry failed refund');
    expect(template).toContain('Automatic refund checks stopped');
    expect(template).toContain('No refunds currently need manual recovery.');
    expect(template).not.toContain('Terminal refund');
    expect(template).not.toContain('Stopped refund processing');
    expect(template).not.toContain('application append-only platform audit');
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
const loadReimbursementQueue = vi.fn();
const loadTransactions = vi.fn();
const openDialog = vi.fn();
const recordReimbursementMutation = vi.fn();

const tenantContext = PlatformFinanceTenantContext.make({
  currency: 'EUR',
  receiptCountryConfig: { allowOther: false, receiptCountries: ['DE'] },
  targetTenantId: 'tenant-1',
  timezone: 'Australia/Brisbane',
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
    previewImageUrl: `https://example.test/${id}.pdf`,
    purchaseCountry: 'DE',
    receiptDate: '2026-07-09',
    receiptEvidenceAvailable: true,
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

  beforeEach(async () => {
    loadRecoveryQueue.mockResolvedValue({ claims: [], tenantContext });
    loadReimbursementQueue.mockResolvedValue({ groups: [], tenantContext });
    loadTransactions.mockResolvedValue({
      data: [],
      tenantContext,
      total: 0,
    });
    openDialog.mockReturnValue({ afterClosed: () => of(false) });
    recordReimbursementMutation.mockResolvedValue({ receiptCount: 2 });
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { gcTime: 0, retry: false },
      },
    });

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
            approvalQueue: () => ({
              queryFn: async () => ({ groups: [], tenantContext }),
              queryKey: ['platform-finance', 'approval'],
            }),
            financeFilter: () => ({
              queryKey: ['platform', 'finance'],
            }),
            recordReimbursement: () => ({
              mutationFn: recordReimbursementMutation,
              mutationKey: ['platform-finance', 'record-reimbursement'],
            }),
            recoveryQueue: () => ({
              queryFn: loadRecoveryQueue,
              queryKey: ['platform-finance', 'recovery'],
            }),
            reimbursementQueue: () => ({
              queryFn: loadReimbursementQueue,
              queryKey: ['platform-finance', 'reimbursement'],
            }),
            requeueRefundClaim: () => ({
              mutationFn: vi.fn(),
              mutationKey: ['platform-finance', 'requeue'],
            }),
            reviewReceipt: () => ({
              mutationFn: vi.fn(),
              mutationKey: ['platform-finance', 'review'],
            }),
            transactions: () => ({
              queryFn: loadTransactions,
              queryKey: ['platform-finance', 'transactions'],
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    queryClient.clear();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
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
        'Action required in Stripe',
        'Pending',
        'Retrying',
        'Succeeded',
        'Needs attention',
      ]) {
        expect(text).toContain(label);
      }
      expect(text).toContain(
        'Open Refund recovery to review the safe next step.',
      );
      expect(text).not.toContain('Provider secret must never render');
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
    await tabs.selectTab({ label: 'Refund recovery' });

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
        PlatformReimbursementConfirmationDialogComponent,
        {
          data: {
            currency: 'EUR',
            payoutDestination: 'DE89370400440532013000',
            payoutMethod: 'Bank transfer',
            receiptCount: 2,
            recipient: 'Ada Lovelace',
            totalAmount: 2900,
          } satisfies PlatformReimbursementConfirmationData,
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

    component['recordReimbursement'](new Event('submit'));

    await vi.waitFor(() => {
      expect(recordReimbursementMutation).toHaveBeenCalledTimes(1);
    });
    expect(recordReimbursementMutation.mock.calls[0]?.[0]).toEqual({
      payoutType: 'iban',
      payoutVersion: 'iban-version-1',
      reason: 'Paid by bank transfer',
      receiptIds: ['receipt-1', 'receipt-2'],
      targetTenantId: 'tenant-1',
    });
    await vi.waitFor(() => {
      expect(component['selectedReimbursement']()).toBeNull();
      expect(component['reimbursementForm'].receiptIds().value()).toEqual([]);
    });
    expect(refresh).toHaveBeenCalledOnce();
    if (!resolveRefresh) {
      throw new Error('Expected the pending finance refresh to be registered');
    }
    resolveRefresh();
  });

  it('locks recipient selection and preserves a newer batch when an older write completes', async () => {
    let resolveReimbursement:
      ((result: { receiptCount: number }) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const pendingReimbursement = new Promise<{ receiptCount: number }>(
      (resolve) => {
        resolveReimbursement = resolve;
      },
    );
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
    expect(template).toContain(
      '[disabled]="reimbursementMutation.isPending()"',
    );

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
    resolveReimbursement({ receiptCount: 2 });

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
      ((result: { receiptCount: number }) => void) | undefined;
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const pendingReimbursement = new Promise<{ receiptCount: number }>(
      (resolve) => {
        resolveReimbursement = resolve;
      },
    );
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
    resolveReimbursement({ receiptCount: 2 });

    await vi.waitFor(() => {
      expect(component['reimbursementMutation'].isPending()).toBe(false);
      expect(component['selectedReimbursement']()).toBeNull();
      expect(component['reimbursementForm'].receiptIds().value()).toEqual([]);
    });
  });

  it('clears tenant-scoped selections and form models when the tenant changes', async () => {
    const receipt = PlatformFinanceReceiptWithSubmitterRecord.make({
      alcoholAmount: 0,
      attachmentFileName: 'tenant-a-receipt.pdf',
      attachmentMimeType: 'application/pdf',
      createdAt: '2026-07-10T10:00:00.000Z',
      currency: 'EUR',
      depositAmount: 0,
      eventId: 'tenant-a-event',
      hasAlcohol: false,
      hasDeposit: false,
      id: 'tenant-a-receipt',
      previewImageUrl: 'https://example.test/tenant-a-receipt.pdf',
      purchaseCountry: 'DE',
      receiptDate: '2026-07-09',
      receiptEvidenceAvailable: true,
      refundedAt: null,
      refundTransactionId: null,
      rejectionReason: null,
      reviewedAt: null,
      status: 'submitted',
      submittedByEmail: 'tenant-a-participant@example.test',
      submittedByFirstName: 'Tenant A',
      submittedByLastName: 'Participant',
      submittedByUserId: 'tenant-a-user',
      taxAmount: 190,
      totalAmount: 1190,
      updatedAt: '2026-07-10T10:00:00.000Z',
    });
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

    component['chooseReceipt'](
      receipt,
      'Tenant A event',
      '2026-07-20T10:00:00.000Z',
    );
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
});
