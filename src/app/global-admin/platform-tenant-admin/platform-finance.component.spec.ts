import type { Schema } from 'effect';

import { Component, input, LOCALE_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  PlatformFinanceCheckoutRecoveryClaim,
  PlatformFinanceCheckoutRecoveryQueue,
  PlatformFinanceRefundRecoveryRecord,
} from '../../../shared/rpc-contracts/app-rpcs/platform-tenant-finance.rpcs';
import { NotificationService } from '../../core/notification.service';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import {
  PlatformFinanceComponent,
  PlatformFinanceOperations,
} from './platform-finance.component';
import { PlatformTenantPageHeaderComponent } from './platform-tenant-page-header.component';

@Component({ selector: 'app-platform-tenant-page-header', template: '' })
class PlatformTenantPageHeaderStub {
  readonly tenantId = input.required<string>();
  readonly title = input.required<string>();
}
const loadCheckoutRecoveryQueue =
  vi.fn<
    () => Promise<
      Schema.Schema.Type<
        typeof PlatformFinanceCheckoutRecoveryQueue.successSchema
      >
    >
  >();
const recoverCheckoutMutation =
  vi.fn<
    NonNullable<
      ReturnType<PlatformFinanceOperations['recoverCheckout']>['mutationFn']
    >
  >();
const requeueRefundMutation =
  vi.fn<
    NonNullable<
      ReturnType<PlatformFinanceOperations['requeueRefundClaim']>['mutationFn']
    >
  >();
const loadRecoveryQueue = vi.fn();
const tenantContext = { currency: 'EUR', timezone: 'Europe/Berlin' };

describe('Platform payment support', () => {
  let queryClient: QueryClient;
  beforeEach(async () => {
    loadRecoveryQueue.mockResolvedValue({ claims: [], tenantContext });
    loadCheckoutRecoveryQueue.mockResolvedValue({
      data: [],
      targetTenantId: 'tenant-1',
      timezone: 'Europe/Berlin',
      total: 0,
    });
    recoverCheckoutMutation.mockResolvedValue({
      claimId: 'checkout-claim',
      sessionState: 'open',
    });
    requeueRefundMutation.mockResolvedValue({
      mode: 'newGeneration',
      refundClaimId: 'refund-claim',
      transferRecovery: 'notTransfer',
    });
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
        { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
        {
          provide: NotificationService,
          useValue: { showError: vi.fn(), showSuccess: vi.fn() },
        },
        {
          provide: PlatformFinanceOperations,
          useValue: {
            checkoutRecoveryQueue: (input: {
              limit: number;
              offset: number;
              targetTenantId: string;
            }) => ({
              queryFn: loadCheckoutRecoveryQueue,
              queryKey: ['payment-support', 'checkout', input],
            }),
            financeFilter: () => ({ queryKey: ['payment-support'] }),
            recoverCheckout: () => ({ mutationFn: recoverCheckoutMutation }),
            recoveryQueue: (targetTenantId: string) => ({
              queryFn: loadRecoveryQueue,
              queryKey: ['payment-support', 'refund', targetTenantId],
            }),
            requeueRefundClaim: () => ({ mutationFn: requeueRefundMutation }),
          },
        },
      ],
    }).compileComponents();
  });
  afterEach(() => {
    queryClient.clear();
    TestBed.resetTestingModule();
    vi.resetAllMocks();
  });
  const checkoutClaim = PlatformFinanceCheckoutRecoveryClaim.make({
    amount: 2500,
    attendeeFirstName: 'Ada',
    attendeeLastName: 'Lovelace',
    createdAt: '2026-07-10T10:00:00.000Z',
    currency: 'EUR',
    eventTitle: 'City tour',
    id: 'checkout-claim',
    version: 'a'.repeat(64),
  });

  it('preserves a confirmed checkout recovery when finance readback fails', async () => {
    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    await vi.waitFor(() =>
      expect(component['checkoutRecoveryQueueQuery'].isSuccess()).toBe(true),
    );
    component['chooseCheckoutClaim'](checkoutClaim);
    component['checkoutRecoveryModel'].update((model) => ({
      ...model,
      reason: 'Restore the verified original payment',
    }));
    loadCheckoutRecoveryQueue.mockRejectedValue(
      new Error('Readback unavailable'),
    );
    component['recoverCheckout'](new Event('submit'));
    await vi.waitFor(() =>
      expect(component['financeOutcome']()).toMatchObject({
        kind: 'confirmed',
        readState: 'failed',
      }),
    );
    expect(recoverCheckoutMutation.mock.calls[0]?.[0]).toEqual({
      claimId: checkoutClaim.id,
      expectedVersion: checkoutClaim.version,
      reason: 'Restore the verified original payment',
      targetTenantId: 'tenant-1',
    });
    expect(component['financeOutcome']()?.summary).toContain(
      'Payment link restored',
    );
    component['recoverCheckout'](new Event('submit'));
    expect(recoverCheckoutMutation).toHaveBeenCalledTimes(1);
  });

  it('holds an unconfirmed checkout recovery until an explicit readback and never repeats the write', async () => {
    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    await vi.waitFor(() =>
      expect(component['checkoutRecoveryQueueQuery'].isSuccess()).toBe(true),
    );
    component['chooseCheckoutClaim'](checkoutClaim);
    component['checkoutRecoveryModel'].update((model) => ({
      ...model,
      reason: 'Investigate held sign-up',
    }));
    recoverCheckoutMutation.mockRejectedValue(new Error('Response lost'));
    component['recoverCheckout'](new Event('submit'));
    await vi.waitFor(() =>
      expect(component['financeOutcome']()).toMatchObject({
        kind: 'unknown',
        readState: 'unchecked',
      }),
    );
    expect(component['checkoutRecoveryForm'].reason().value()).toBe(
      'Investigate held sign-up',
    );
    component['recoverCheckout'](new Event('submit'));
    expect(recoverCheckoutMutation).toHaveBeenCalledTimes(1);
    await component['showLatestFinance']();
    expect(component['financeOutcome']()).toBeNull();
    expect(component['selectedCheckoutClaim']()).toBeNull();
    expect(component['checkoutRecoveryForm'].reason().value()).toBe('');
    expect(recoverCheckoutMutation).toHaveBeenCalledTimes(1);
  });

  it('clears checkout recovery identity, reason and page when the target organization changes', async () => {
    const fixture = TestBed.createComponent(PlatformFinanceComponent);
    fixture.componentRef.setInput('tenantId', 'tenant-1');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    await vi.waitFor(() =>
      expect(component['checkoutRecoveryQueueQuery'].isSuccess()).toBe(true),
    );
    component['chooseCheckoutClaim'](checkoutClaim);
    component['checkoutRecoveryModel'].update((model) => ({
      ...model,
      reason: 'Tenant A reason',
    }));
    component['checkoutPageIndex'].set(2);
    fixture.componentRef.setInput('tenantId', 'tenant-2');
    fixture.detectChanges();
    expect(component['selectedCheckoutClaim']()).toBeNull();
    expect(component['checkoutRecoveryModel']()).toEqual({
      claimId: '',
      expectedVersion: '',
      reason: '',
    });
    expect(component['checkoutPageIndex']()).toBe(0);
    expect(recoverCheckoutMutation).not.toHaveBeenCalled();
  });

  const refundClaim = PlatformFinanceRefundRecoveryRecord.make({
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
  });
  it.each(['confirmed', 'unknown'] as const)(
    'holds a %s refund outcome until an explicit fresh read without repeating the write',
    async (kind) => {
      const fixture = TestBed.createComponent(PlatformFinanceComponent);
      fixture.componentRef.setInput('tenantId', 'tenant-1');
      fixture.detectChanges();
      const component = fixture.componentInstance;
      await vi.waitFor(() =>
        expect(component['recoveryQueueQuery'].isSuccess()).toBe(true),
      );
      component['chooseRefundClaim'](refundClaim);
      component['refundRecoveryModel'].update((model) => ({
        ...model,
        reason: 'Checked refund eligibility',
      }));
      if (kind === 'confirmed')
        loadRecoveryQueue.mockRejectedValue(new Error('Readback unavailable'));
      else requeueRefundMutation.mockRejectedValue(new Error('Response lost'));
      component['requeueRefundClaim'](new Event('submit'));
      await vi.waitFor(() =>
        expect(component['financeOutcome']()).toMatchObject({
          kind,
          readState: kind === 'confirmed' ? 'failed' : 'unchecked',
        }),
      );
      expect(requeueRefundMutation.mock.calls[0]?.[0]).toEqual({
        reason: 'Checked refund eligibility',
        refundClaimId: 'refund-claim',
        targetTenantId: 'tenant-1',
      });
      component['requeueRefundClaim'](new Event('submit'));
      expect(requeueRefundMutation).toHaveBeenCalledTimes(1);
      loadRecoveryQueue.mockResolvedValue({ claims: [], tenantContext });
      await component['showLatestFinance']();
      expect(component['financeOutcome']()).toBeNull();
      expect(component['selectedRefundClaim']()).toBeNull();
      expect(requeueRefundMutation).toHaveBeenCalledTimes(1);
    },
  );
});
