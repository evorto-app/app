import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PlatformFinanceRefundLifecycleSummary,
  PlatformFinanceTenantContext,
} from '../../../shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';
import { NotificationService } from '../../core/notification.service';
import {
  PlatformFinanceComponent,
  PlatformFinanceOperations,
  platformReceiptEvidenceUnavailableNotice,
  platformReceiptReviewDisabled,
  platformRefundLifecycleCopy,
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
        'Automatic processing stopped. 8 of 8 attempts used. Open Refund recovery to review it.',
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
        'This refund is not eligible for safe requeue. 1 of 8 attempts used. It will not appear in Refund recovery; review its recorded payment source and lifecycle state.',
      label: 'Needs attention',
    });
  });

  it('opens recovery only for provider action claims that can be resumed', () => {
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
      'automatic status checks remain scheduled',
    );
    expect(scheduled.detail).not.toContain('open Refund recovery');
    expect(stopped.detail).toContain('open Refund recovery');
  });

  it('distinguishes all non-attention states', () => {
    const expectedLabels: readonly (readonly [
      PlatformFinanceRefundLifecycleSummary['status'],
      string,
    ])[] = [
      ['action-required', 'Provider action required'],
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
});

const loadTransactions = vi.fn();

const tenantContext = PlatformFinanceTenantContext.make({
  currency: 'EUR',
  receiptCountryConfig: { allowOther: false, receiptCountries: ['DE'] },
  targetTenantId: 'tenant-1',
});

const normalizeText = (fixture: ComponentFixture<PlatformFinanceComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('PlatformFinanceComponent refund lifecycle table', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
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
              mutationFn: vi.fn(),
              mutationKey: ['platform-finance', 'record-reimbursement'],
            }),
            recoveryQueue: () => ({
              queryFn: async () => ({ claims: [], tenantContext }),
              queryKey: ['platform-finance', 'recovery'],
            }),
            reimbursementQueue: () => ({
              queryFn: async () => ({ groups: [], tenantContext }),
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
        'Provider action required',
        'Pending',
        'Retrying',
        'Succeeded',
        'Needs attention',
      ]) {
        expect(text).toContain(label);
      }
      expect(text).toContain('Open Refund recovery to review it.');
      expect(text).not.toContain('Provider secret must never render');
    });
  });
});
