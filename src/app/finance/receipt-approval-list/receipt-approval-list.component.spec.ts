import '@angular/compiler';
import { type ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  createRpcMutationOptions,
  createRpcQueryOptions,
} from '@heddendorp/effect-angular-query';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import { ReceiptRefundListComponent } from '../receipt-refund-list/receipt-refund-list.component';
import { ReceiptApprovalListComponent } from './receipt-approval-list.component';

const cases = [
  {
    component: ReceiptApprovalListComponent,
    emptyMessage: 'No receipts pending approval.',
    failureMessage: 'The pending receipts could not be loaded.',
    loadingMessage: 'Loading receipts…',
    query: 'pendingApprovalGrouped',
  },
  {
    component: ReceiptRefundListComponent,
    emptyMessage: 'No approved receipts are waiting for reimbursement.',
    failureMessage: 'The refundable receipts could not be loaded.',
    loadingMessage: 'Loading refundable receipts…',
    query: 'refundableGroupedByRecipient',
  },
];

for (const scenario of cases) {
  describe(`${scenario.query} receipt queue recovery`, () => {
    let fixture: ComponentFixture<unknown> | undefined;
    let queryClient: QueryClient | undefined;
    let releaseRetry: (() => void) | undefined;

    afterEach(async () => {
      const failures: unknown[] = [];
      for (const cleanup of [
        () => releaseRetry?.(),
        () => queryClient?.cancelQueries(),
        () => fixture?.destroy(),
        () => queryClient?.clear(),
        () => TestBed.resetTestingModule(),
      ]) {
        try {
          await cleanup();
        } catch (error) {
          failures.push(error);
        }
      }
      fixture = undefined;
      queryClient = undefined;
      releaseRetry = undefined;
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          'Receipt queue fixture cleanup failed',
          {
            cause: failures[0],
          },
        );
      }
    });

    it('retries a failed initial read once and removes the action while pending without recording a reimbursement', async () => {
      // Angular's browser target does not expose Promise.withResolvers.

      const retry = new Promise<[]>((resolve) => {
        releaseRetry = () => resolve([]);
      });
      const findReceipts = vi
        .fn<() => Promise<[]>>()
        .mockRejectedValueOnce(new Error('Receipt query unavailable'))
        .mockReturnValue(retry);
      const createRefund = vi.fn(async () => ({
        receiptCount: 0,
        totalAmount: 0,
        transactionId: 'unexpected-reimbursement',
      }));
      queryClient = new QueryClient({
        defaultOptions: { queries: { gcTime: 0, retry: false } },
      });
      await TestBed.configureTestingModule({
        imports: [scenario.component, MatDialogModule],
        providers: [
          provideNoopAnimations(),
          provideTanStackQuery(queryClient),
          { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
          {
            provide: NotificationService,
            useValue: { showError: vi.fn(), showSuccess: vi.fn() },
          },
          {
            provide: APP_RPC_CLIENT,
            useValue: {
              finance: {
                receipts: {
                  createRefund: {
                    mutationOptions: () =>
                      createRpcMutationOptions({
                        keyPrefix: 'rpc',
                        mutationFn: createRefund,
                        pathSegments: ['finance', 'receipts', 'createRefund'],
                      }),
                  },
                  [scenario.query]: {
                    queryOptions: () =>
                      createRpcQueryOptions({
                        keyPrefix: 'rpc',
                        pathSegments: ['finance', 'receipts', scenario.query],
                        queryFn: findReceipts,
                        type: 'query',
                      }),
                  },
                },
              },
            },
          },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent<unknown>(scenario.component);
      const ownedFixture = fixture;
      const root: unknown = fixture.nativeElement;
      if (!(root instanceof HTMLElement))
        throw new Error('Missing receipt queue root');
      ownedFixture.detectChanges();
      await vi.waitFor(() => {
        ownedFixture.detectChanges();
        expect(root.textContent).toContain(scenario.failureMessage);
      });
      expect(findReceipts).toHaveBeenCalledOnce();
      const button = [...root.querySelectorAll('button')].find(
        (candidate) => candidate.textContent?.trim() === 'Try again',
      );
      if (!button) throw new Error('Missing receipt queue retry action');
      expect(root.querySelector('[role="alert"]')?.textContent).toContain(
        scenario.failureMessage,
      );
      button.click();
      await vi.waitFor(() => {
        ownedFixture.detectChanges();
        expect(findReceipts).toHaveBeenCalledTimes(2);
        expect(root.textContent).toContain(scenario.loadingMessage);
        expect(root.querySelector('button')).toBeNull();
      });
      expect(findReceipts).toHaveBeenCalledTimes(2);
      releaseRetry?.();
      await vi.waitFor(() => {
        ownedFixture.detectChanges();
        expect(root.textContent).toContain(scenario.emptyMessage);
        expect(root.querySelector('[role="alert"]')).toBeNull();
      });
      expect(findReceipts).toHaveBeenCalledTimes(2);
      expect(createRefund).not.toHaveBeenCalled();
      expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(0);
    });
  });
}
