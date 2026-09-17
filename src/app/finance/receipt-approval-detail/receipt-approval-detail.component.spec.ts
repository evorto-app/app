import '@angular/compiler';
import type { ClientTenantConfig } from '@shared/rpc-contracts/app-rpcs/config.rpcs';
import type {
  FinanceReceiptForApprovalRecord,
  FinanceReceiptsReview,
} from '@shared/rpc-contracts/app-rpcs/finance.rpcs';
import type { MutationFunctionContext } from '@tanstack/angular-query-experimental';
import type { Schema } from 'effect';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
  Router,
} from '@angular/router';
import {
  createRpcMutationOptions,
  createRpcQueryFilter,
  createRpcQueryKey,
  createRpcQueryOptions,
} from '@heddendorp/effect-angular-query';
import {
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
} from '@shared/errors/rpc-errors';
import {
  FinanceReceiptNotFoundError,
  FinanceResourceNotFoundError,
  ReceiptMediaBadRequestError,
  ReceiptMediaServiceUnavailableError,
} from '@shared/rpc-contracts/app-rpcs/finance.errors';
import {
  provideTanStackQuery,
  QueryClient,
  QueryObserver,
} from '@tanstack/angular-query-experimental';
import { BehaviorSubject } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import {
  ReceiptApprovalDetailComponent,
  receiptApprovalDisabled,
  receiptEvidenceUnavailableNotice,
  receiptRejectionDisabled,
  receiptReviewActionDisabled,
  receiptReviewCountries,
  receiptReviewNotificationNotice,
  receiptReviewSuccessMessage,
} from './receipt-approval-detail.component';

describe('receiptReviewCountries', () => {
  it('retains the recorded country after it is removed from tenant settings', () => {
    expect(receiptReviewCountries(['NL'], 'DE')).toEqual(['NL', 'DE']);
    expect(receiptReviewCountries(['NL'], 'OTHER')).toEqual(['NL', 'OTHER']);
  });

  it('does not add unrelated countries or duplicate an allowed country', () => {
    expect(receiptReviewCountries(['NL'], undefined)).toEqual(['NL']);
    expect(receiptReviewCountries(['NL'], 'NL')).toEqual(['NL']);
  });
});

describe('receiptReviewSuccessMessage', () => {
  it('explains that review actions queue submitter notification', () => {
    expect(receiptReviewNotificationNotice).toBe(
      'Saving this decision asks Evorto to email the submitter. Delivery may take time or fail.',
    );
  });

  it('explains why approval is unavailable without blocking rejection', () => {
    expect(receiptEvidenceUnavailableNotice).toBe(
      'The uploaded receipt file is unavailable. You cannot approve the receipt until the file can be checked, but you can still reject it.',
    );
  });

  it('keeps approval feedback honest about queued submitter notification', () => {
    expect(receiptReviewSuccessMessage('approved')).toBe(
      'Receipt approved. Evorto will now try to email the submitter.',
    );
  });

  it('keeps rejection feedback honest about queued submitter notification', () => {
    expect(receiptReviewSuccessMessage('rejected')).toBe(
      'Receipt rejected. Evorto will now try to email the submitter.',
    );
  });
});

describe('receiptReviewActionDisabled', () => {
  it('blocks review writes while the form is invalid, the receipt is loading, or the mutation is pending', () => {
    expect(
      receiptReviewActionDisabled({
        formInvalid: false,
        mutationPending: false,
        receiptPending: false,
      }),
    ).toBe(false);
    expect(
      receiptReviewActionDisabled({
        formInvalid: true,
        mutationPending: false,
        receiptPending: false,
      }),
    ).toBe(true);
    expect(
      receiptReviewActionDisabled({
        formInvalid: false,
        mutationPending: false,
        receiptPending: true,
      }),
    ).toBe(true);
    expect(
      receiptReviewActionDisabled({
        formInvalid: false,
        mutationPending: true,
        receiptPending: false,
      }),
    ).toBe(true);
  });

  it('blocks approval but still permits a reasoned rejection when receipt evidence is unavailable', () => {
    const reviewState = {
      formInvalid: false,
      mutationPending: false,
      receiptPending: false,
    };

    expect(
      receiptApprovalDisabled({
        evidenceAvailable: false,
        ...reviewState,
      }),
    ).toBe(true);
    expect(
      receiptRejectionDisabled({
        rejectionReason: 'The uploaded file cannot be verified.',
        ...reviewState,
      }),
    ).toBe(false);
    expect(
      receiptApprovalDisabled({
        evidenceAvailable: true,
        ...reviewState,
      }),
    ).toBe(false);
  });
});

describe('receiptRejectionDisabled', () => {
  it('requires a nonblank reason before a receipt can be rejected', () => {
    const reviewState = {
      formInvalid: false,
      mutationPending: false,
      receiptPending: false,
    };

    expect(
      receiptRejectionDisabled({ rejectionReason: '', ...reviewState }),
    ).toBe(true);
    expect(
      receiptRejectionDisabled({
        rejectionReason: ' '.repeat(3),
        ...reviewState,
      }),
    ).toBe(true);
    expect(
      receiptRejectionDisabled({
        rejectionReason: 'The receipt date is unreadable.',
        ...reviewState,
      }),
    ).toBe(false);
    expect(
      receiptRejectionDisabled({
        rejectionReason: 'The receipt date is unreadable.',
        ...reviewState,
        mutationPending: true,
      }),
    ).toBe(true);
  });
});

type ReviewPayload = Schema.Schema.Type<
  typeof FinanceReceiptsReview.payloadSchema
>;

const approvalReceipt: FinanceReceiptForApprovalRecord = {
  alcoholAmount: 0,
  attachmentFileName: 'receipt.pdf',
  attachmentMimeType: 'application/pdf',
  attachmentStorageKey: 'receipt/owned-file',
  createdAt: '2026-09-01T09:00:00Z',
  currency: 'EUR',
  depositAmount: 0,
  eventId: 'event-1',
  eventStart: '2026-09-01T10:00:00Z',
  eventTitle: 'Welcome Week',
  hasAlcohol: false,
  hasDeposit: false,
  id: 'receipt-1',
  previewImageUrl: '/receipt-preview/owned-file',
  purchaseCountry: 'DE',
  receiptDate: '2026-09-01',
  receiptEvidenceAvailable: true,
  refundedAt: null,
  refundTransactionId: null,
  rejectionReason: null,
  reviewedAt: null,
  status: 'submitted',
  submittedByEmail: 'ada@example.test',
  submittedByFirstName: 'Ada',
  submittedByLastName: 'Lovelace',
  submittedByUserId: 'user-1',
  taxAmount: 100,
  totalAmount: 1299,
  updatedAt: '2026-09-01T09:00:00Z',
};

const reviewPath = ['finance', 'receipts', 'review'];
const approvalPath = ['finance', 'receipts', 'findOneForApproval'];
const receiptQueryKey = (id: string) =>
  createRpcQueryKey(approvalPath, {
    input: { id },
    keyPrefix: 'rpc',
    type: 'query',
  });
const approvalReceiptKey = receiptQueryKey('receipt-1');
const reviewListPaths = [
  ['finance', 'receipts', 'pendingApprovalGrouped'],
  ['finance', 'receipts', 'refundableGroupedByRecipient'],
  ['finance', 'receipts', 'byEvent'],
];

const approvalRoot = (
  fixture: ComponentFixture<ReceiptApprovalDetailComponent>,
): HTMLElement => {
  const root: unknown = fixture.nativeElement;
  if (!(root instanceof HTMLElement))
    throw new Error('Missing receipt review root');
  return root;
};

const approvalButton = (
  fixture: ComponentFixture<ReceiptApprovalDetailComponent>,
  label: string,
): HTMLButtonElement => {
  const button = [...approvalRoot(fixture).querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Missing ${label} button`);
  return button;
};

describe('receipt review component mutation outcomes', () => {
  let fixture: ComponentFixture<ReceiptApprovalDetailComponent>;
  let queryClient: QueryClient;
  let cleanupQueryClient: QueryClient | undefined;
  let cleanupFixture:
    ComponentFixture<ReceiptApprovalDetailComponent> | undefined;
  let releases: (() => void)[];
  let disposals: (() => void)[];
  let actions: Promise<PromiseSettledResult<void>>[];
  let actionSettlements: PromiseSettledResult<void>[];
  let routeParameters: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  const findReceipt =
    vi.fn<(id: string) => Promise<FinanceReceiptForApprovalRecord>>();
  const reviewReceipt =
    vi.fn<
      (
        input: ReviewPayload,
        context: MutationFunctionContext,
      ) => Promise<{ id: string; status: 'approved' | 'rejected' }>
    >();
  const notifications = {
    showError: vi.fn<(message: string) => void>(),
    showSuccess: vi.fn<(message: string) => void>(),
  };

  const ownAction = (action: Promise<void>) => {
    const settlements = actionSettlements;
    actions.push(
      action.then<PromiseSettledResult<void>, PromiseSettledResult<void>>(
        () => {
          const result: PromiseFulfilledResult<void> = {
            status: 'fulfilled',
            value: undefined,
          };
          settlements.push(result);
          return result;
        },
        (error: unknown) => {
          const result: PromiseRejectedResult = {
            reason: error,
            status: 'rejected',
          };
          settlements.push(result);
          return result;
        },
      ),
    );
    return action;
  };

  const gate = <T>(fallback: T) => {
    let resolve: (value: T) => void = () => {
      throw new Error('Gate not initialized');
    };
    // Angular's browser library target does not expose Promise.withResolvers.
    // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
    const promise = new Promise<T>((complete) => {
      resolve = complete;
    });
    releases.push(() => resolve(fallback));
    return { promise, resolve: (value: T) => resolve(value) };
  };

  const observeList = (
    path: readonly string[],
    suffix: string,
    queryFn: () => Promise<string[]>,
    options: { enabled?: boolean; staleTime?: 'static' } = {},
  ) => {
    const queryKey = createRpcQueryKey(path, {
      input: { fixture: suffix },
      keyPrefix: 'rpc',
      type: 'query',
    });
    queryClient.setQueryData(queryKey, ['before']);
    const observer = new QueryObserver(queryClient, {
      queryFn,
      queryKey,
      staleTime: Infinity,
      ...options,
    });
    const unsubscribe = observer.subscribe(() => {
      // Keep this owned query active for follow-up reads.
    });
    disposals.push(unsubscribe, () => observer.destroy());
    return queryKey;
  };

  const editedFields = () => fixture.componentInstance['form'].getRawValue();
  const expectRetained = () => {
    expect(editedFields()).toEqual({
      alcoholAmount: 2,
      depositAmount: 1,
      hasAlcohol: true,
      hasDeposit: true,
      purchaseCountry: 'DE',
      receiptDate: '2026-09-02',
      taxAmount: 1.2,
      totalAmount: 23.45,
    });
    expect(fixture.componentInstance['rejectionReason']()).toBe(
      '  The receipt is incomplete.  ',
    );
  };

  beforeEach(async () => {
    cleanupFixture = undefined;
    cleanupQueryClient = undefined;
    releases = [];
    disposals = [];
    actions = [];
    actionSettlements = [];
    routeParameters = new BehaviorSubject(
      convertToParamMap({ receiptId: 'receipt-1' }),
    );
    disposals.push(() => routeParameters.complete());
    findReceipt.mockReset().mockResolvedValue(approvalReceipt);
    reviewReceipt.mockReset().mockImplementation(async (input) => ({
      id: input.id,
      status: input.status,
    }));
    notifications.showError.mockReset();
    notifications.showSuccess.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        mutations: { retry: 2, retryDelay: 0 },
        queries: { gcTime: 0, retry: false },
      },
    });
    cleanupQueryClient = queryClient;
    await TestBed.configureTestingModule({
      imports: [ReceiptApprovalDetailComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        provideTanStackQuery(queryClient),
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: routeParameters,
            snapshot: { paramMap: routeParameters.value },
          },
        },
        {
          provide: ConfigService,
          useValue: {
            tenant: {
              receiptSettings: { allowOther: false, receiptCountries: ['NL'] },
            },
          } satisfies { tenant: Pick<ClientTenantConfig, 'receiptSettings'> },
        },
        { provide: NotificationService, useValue: notifications },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            finance: {
              receipts: {
                findOneForApproval: {
                  queryKey: ({ id }: { id: string }) => receiptQueryKey(id),
                  queryOptions: ({ id }: { id: string }) =>
                    createRpcQueryOptions({
                      input: { id },
                      keyPrefix: 'rpc',
                      pathSegments: approvalPath,
                      queryFn: () => findReceipt(id),
                      type: 'query',
                    }),
                },
                review: {
                  mutationOptions: () =>
                    createRpcMutationOptions({
                      keyPrefix: 'rpc',
                      mutationFn: reviewReceipt,
                      pathSegments: reviewPath,
                    }),
                },
              },
            },
            queryFilter: (path: readonly string[]) =>
              createRpcQueryFilter(path, { keyPrefix: 'rpc' }),
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ReceiptApprovalDetailComponent);
    cleanupFixture = fixture;
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(editedFields().totalAmount).toBe(12.99);
    });
    fixture.componentInstance['form'].patchValue({
      alcoholAmount: 2,
      depositAmount: 1,
      hasAlcohol: true,
      hasDeposit: true,
      receiptDate: '2026-09-02',
      taxAmount: 1.2,
    });
    const totalField = [
      ...approvalRoot(fixture).querySelectorAll('mat-form-field'),
    ].find(
      (field) =>
        field.querySelector('mat-label')?.textContent?.trim() ===
        'Total amount (EUR)',
    );
    const totalInput = totalField?.querySelector('input');
    if (!(totalInput instanceof HTMLInputElement))
      throw new Error('Missing total amount input');
    totalInput.value = '23.45';
    totalInput.dispatchEvent(new Event('input', { bubbles: true }));
    const reason = approvalRoot(fixture).querySelector('textarea');
    if (!reason) throw new Error('Missing rejection reason input');
    reason.value = '  The receipt is incomplete.  ';
    reason.dispatchEvent(new Event('input', { bubbles: true }));
    fixture.detectChanges();
    expectRetained();
    vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    const ownedFixture = cleanupFixture;
    const ownedClient = cleanupQueryClient;
    const ownedActions = actions ?? [];
    const settlements = actionSettlements ?? [];
    cleanupFixture = undefined;
    cleanupQueryClient = undefined;
    // Independent disposal still runs if closing a dialog or releasing a gate fails.
    for (const dispose of [
      ...(releases ?? []),
      ...(disposals ?? []),
      () => ownedFixture?.destroy(),
      () => ownedClient?.clear(),
      () => TestBed.resetTestingModule(),
      () => vi.restoreAllMocks(),
    ]) {
      try {
        dispose();
      } catch (error) {
        failures.push(error);
      }
    }
    try {
      await vi.waitFor(
        () => expect(settlements).toHaveLength(ownedActions.length),
        {
          interval: 10,
          timeout: 1000,
        },
      );
      await Promise.all(ownedActions);
    } catch (error) {
      failures.push(error);
    }
    for (const result of settlements) {
      if (result.status === 'rejected') failures.push(result.reason);
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Receipt review test cleanup failed', {
        cause: failures[0],
      });
  });

  it.each(['approved', 'rejected'] as const)(
    'saves the exact %s payload and refreshes all canonical list families before navigation',
    async (status) => {
      const reads = reviewListPaths.map((path) => {
        const read = vi.fn(async () => ['current']);
        observeList(path, 'active', read);
        return read;
      });
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      await ownAction(
        fixture.componentInstance[
          status === 'approved' ? 'approve' : 'reject'
        ](),
      );
      expect(reviewReceipt).toHaveBeenCalledExactlyOnceWith(
        {
          alcoholAmount: 200,
          depositAmount: 100,
          hasAlcohol: true,
          hasDeposit: true,
          id: 'receipt-1',
          purchaseCountry: 'DE',
          receiptDate: '2026-09-02',
          rejectionReason:
            status === 'rejected' ? 'The receipt is incomplete.' : null,
          status,
          taxAmount: 120,
          totalAmount: 2345,
        },
        {
          client: queryClient,
          meta: { rpc: { path: reviewPath } },
          mutationKey: createRpcQueryKey(reviewPath, {
            keyPrefix: 'rpc',
            type: 'mutation',
          }),
        },
      );
      for (const path of reviewListPaths) {
        expect(invalidate).toHaveBeenCalledWith(
          createRpcQueryFilter(path, { keyPrefix: 'rpc' }),
          { throwOnError: true },
        );
      }
      for (const read of reads) expect(read).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledExactlyOnceWith([
        '/finance/receipts-approval',
      ]);
      expect(notifications.showSuccess).toHaveBeenCalledExactlyOnceWith(
        receiptReviewSuccessMessage(status),
      );
      expect(queryClient.getQueryData(approvalReceiptKey)).toBeUndefined();
      expectRetained();
    },
  );

  it.each([
    new RpcBadRequestError({ message: 'Correct the tax amount.' }),
    new FinanceReceiptNotFoundError({
      message: 'This receipt no longer exists.',
    }),
    new FinanceResourceNotFoundError({
      message: 'This event no longer exists.',
    }),
    new ReceiptMediaBadRequestError({
      message: 'The receipt evidence is invalid.',
    }),
    new ReceiptMediaServiceUnavailableError({
      message: 'Receipt evidence is temporarily unavailable.',
    }),
  ])(
    'retains fields and permits correction after expected $_tag denial',
    async (error) => {
      reviewReceipt.mockRejectedValue(error);
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      await ownAction(fixture.componentInstance['approve']());
      fixture.detectChanges();
      expect(notifications.showError).toHaveBeenCalledExactlyOnceWith(
        error.message,
      );
      expect(fixture.componentInstance['reviewLocked']()).toBe(false);
      expect(approvalButton(fixture, 'Approve').disabled).toBe(false);
      expect(invalidate).not.toHaveBeenCalled();
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      expectRetained();
    },
  );

  it.each([
    [
      new RpcUnauthorizedError({ message: 'private authorization detail' }),
      'Sign in again before reviewing this receipt.',
    ],
    [
      new RpcForbiddenError({ message: 'private permission detail' }),
      'You do not have access to review this receipt. Check your active section and permissions.',
    ],
  ])(
    'maps a known access denial to safe corrective copy',
    async (error, message) => {
      reviewReceipt.mockRejectedValue(error);
      await ownAction(fixture.componentInstance['approve']());
      fixture.detectChanges();
      expect(notifications.showError).toHaveBeenCalledExactlyOnceWith(message);
      expect(fixture.componentInstance['reviewLocked']()).toBe(false);
      expect(approvalRoot(fixture).textContent).not.toContain('private');
      expectRetained();
    },
  );

  it.each(['lost response', 'internal error'])(
    'blocks another write after an unconfirmed %s',
    async (failure) => {
      let committed = false;
      reviewReceipt.mockImplementation(async () => {
        committed = true;
        throw failure === 'lost response'
          ? new Error('Connection lost after commit')
          : new RpcInternalServerError({ message: 'private database detail' });
      });
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      await ownAction(fixture.componentInstance['approve']());
      fixture.detectChanges();
      expect(committed).toBe(true);
      expect(
        approvalRoot(fixture).querySelector('[role="alert"]')?.textContent,
      ).toContain('outcome could not be confirmed');
      expect(approvalButton(fixture, 'Approve').disabled).toBe(true);
      await ownAction(fixture.componentInstance['reject']());
      expect(reviewReceipt).toHaveBeenCalledTimes(1);
      expect(invalidate).not.toHaveBeenCalled();
      expect(notifications.showSuccess).not.toHaveBeenCalled();
      expectRetained();
    },
  );

  it('holds the form through the mutation and does not let query updates replace entered values', async () => {
    const mutation = gate({ id: 'receipt-1', status: 'approved' as const });
    reviewReceipt.mockReturnValue(mutation.promise);
    const action = ownAction(fixture.componentInstance['approve']());
    await vi.waitFor(() => expect(reviewReceipt).toHaveBeenCalledTimes(1));
    fixture.detectChanges();
    expect(
      approvalRoot(fixture).querySelector('[role="status"]')?.textContent,
    ).toContain('Saving the receipt review');
    expect(fixture.componentInstance['form'].disabled).toBe(true);
    expect(approvalRoot(fixture).querySelector('textarea')?.disabled).toBe(
      true,
    );
    queryClient.setQueryData(approvalReceiptKey, {
      ...approvalReceipt,
      rejectionReason: 'Server replacement',
      totalAmount: 5000,
    });
    fixture.detectChanges();
    expectRetained();
    await ownAction(fixture.componentInstance['approve']());
    expect(reviewReceipt).toHaveBeenCalledTimes(1);
    mutation.resolve({ id: 'receipt-1', status: 'approved' });
    await action;
  });

  it('drains same-family and other-family active reads after one rejects without awaiting disabled or static reads', async () => {
    const slow = gate(['current']);
    const other = gate(['current']);
    const failedRead = vi.fn(async (): Promise<string[]> => {
      throw new Error('Approval list failed');
    });
    const slowRead = vi.fn(() => slow.promise);
    const otherRead = vi.fn(() => other.promise);
    const disabledRead = vi.fn(async () => ['disabled']);
    const staticRead = vi.fn(async () => ['static']);
    const failedKey = observeList(
      ['finance', 'receipts', 'pendingApprovalGrouped'],
      'failed',
      failedRead,
    );
    const slowKey = observeList(
      ['finance', 'receipts', 'pendingApprovalGrouped'],
      'slow',
      slowRead,
    );
    observeList(
      ['finance', 'receipts', 'refundableGroupedByRecipient'],
      'other',
      otherRead,
    );
    observeList(
      ['finance', 'receipts', 'pendingApprovalGrouped'],
      'disabled',
      disabledRead,
      { enabled: false },
    );
    observeList(
      ['finance', 'receipts', 'pendingApprovalGrouped'],
      'static',
      staticRead,
      { staleTime: 'static' },
    );
    const inactiveKey = createRpcQueryKey(['finance', 'receipts', 'byEvent'], {
      input: { eventId: 'inactive' },
      keyPrefix: 'rpc',
      type: 'query',
    });
    // Keep the intentionally inactive cache entry through the held reads.
    queryClient.setQueryDefaults(inactiveKey, { gcTime: Infinity });
    queryClient.setQueryData(inactiveKey, ['before']);
    expect(
      queryClient
        .getQueryCache()
        .find({ exact: true, queryKey: inactiveKey })
        ?.getObserversCount(),
    ).toBe(0);
    const action = ownAction(fixture.componentInstance['approve']());
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(queryClient.getQueryState(failedKey)?.status).toBe('error');
      expect(slowRead).toHaveBeenCalledTimes(1);
      expect(otherRead).toHaveBeenCalledTimes(1);
      expect(fixture.componentInstance['reviewMutation'].isPending()).toBe(
        false,
      );
    });
    expect(fixture.componentInstance['reviewPhase']()).toBe('refreshing');
    expect(
      approvalRoot(fixture).querySelector('[role="status"]')?.textContent,
    ).toContain('Review saved. Loading');
    expect(approvalButton(fixture, 'Approve').disabled).toBe(true);
    expect(notifications.showError).not.toHaveBeenCalled();
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    await ownAction(fixture.componentInstance['approve']());
    expect(reviewReceipt).toHaveBeenCalledTimes(1);
    slow.resolve(['current']);
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(slowKey)?.fetchStatus).toBe('idle'),
    );
    expect(fixture.componentInstance['reviewPhase']()).toBe('refreshing');
    other.resolve(['current']);
    await action;
    fixture.detectChanges();
    expect(disabledRead).not.toHaveBeenCalled();
    expect(staticRead).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(inactiveKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryData(inactiveKey)).toEqual(['before']);
    expect(queryClient.getQueryState(inactiveKey)?.fetchStatus).toBe('idle');
    expect(
      queryClient
        .getQueryCache()
        .find({ exact: true, queryKey: inactiveKey })
        ?.getObserversCount(),
    ).toBe(0);
    expect(fixture.componentInstance['reviewPhase']()).toBe('saved');
    expect(
      approvalRoot(fixture).querySelector('[role="alert"]')?.textContent,
    ).toContain('review was saved');
    expect(approvalButton(fixture, 'Approve').disabled).toBe(true);
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
    expect(notifications.showSuccess).not.toHaveBeenCalled();
    expectRetained();
  });

  it.each(['false', 'rejected'])(
    'retains a confirmed save when navigation is %s',
    async (outcome) => {
      const navigate = vi.mocked(TestBed.inject(Router).navigate);
      if (outcome === 'false') navigate.mockResolvedValue(false);
      else navigate.mockRejectedValue(new Error('Router failed'));
      await ownAction(fixture.componentInstance['approve']());
      fixture.detectChanges();
      expect(
        approvalRoot(fixture).querySelector('[role="alert"]')?.textContent,
      ).toContain(
        'review was saved, but the approval list could not be opened',
      );
      expect(queryClient.getQueryData(approvalReceiptKey)).toEqual(
        approvalReceipt,
      );
      expect(fixture.componentInstance['reviewLocked']()).toBe(true);
      expect(notifications.showSuccess).not.toHaveBeenCalled();
      await ownAction(fixture.componentInstance['approve']());
      expect(reviewReceipt).toHaveBeenCalledTimes(1);
      expectRetained();
    },
  );

  it('keeps review and Back locked until confirmed navigation finishes', async () => {
    const navigation = gate(true);
    vi.mocked(TestBed.inject(Router).navigate).mockReturnValue(
      navigation.promise,
    );
    const action = ownAction(fixture.componentInstance['approve']());
    await vi.waitFor(() =>
      expect(TestBed.inject(Router).navigate).toHaveBeenCalledTimes(1),
    );
    fixture.detectChanges();
    expect(fixture.componentInstance['reviewMutation'].isPending()).toBe(false);
    expect(approvalButton(fixture, 'Approve').disabled).toBe(true);
    expect(
      approvalRoot(fixture).querySelector('a')?.getAttribute('aria-disabled'),
    ).toBe('true');
    expect(
      approvalRoot(fixture).querySelector('[role="status"]')?.textContent,
    ).toContain('Opening Receipt approvals');
    expect(notifications.showSuccess).not.toHaveBeenCalled();
    await ownAction(fixture.componentInstance['approve']());
    expect(reviewReceipt).toHaveBeenCalledTimes(1);
    navigation.resolve(true);
    await action;
    expect(notifications.showSuccess).toHaveBeenCalledTimes(1);
  });
  it('resets an unconfirmed outcome when the reused route opens a different receipt', async () => {
    reviewReceipt.mockRejectedValueOnce(new Error('Response lost'));
    await ownAction(fixture.componentInstance['approve']());
    expect(fixture.componentInstance['reviewPhase']()).toBe('unknown');
    findReceipt.mockImplementation(async (id) => ({
      ...approvalReceipt,
      id,
      receiptDate: '2026-09-03',
      totalAmount: 4400,
    }));
    routeParameters.next(convertToParamMap({ receiptId: 'receipt-2' }));
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(findReceipt).toHaveBeenCalledWith('receipt-2');
      expect(editedFields().totalAmount).toBe(44);
    });
    expect(fixture.componentInstance['receiptId']()).toBe('receipt-2');
    expect(fixture.componentInstance['reviewPhase']()).toBe('idle');
    expect(fixture.componentInstance['reviewMessage']()).toBeNull();
    expect(approvalButton(fixture, 'Approve').disabled).toBe(false);
    await ownAction(fixture.componentInstance['approve']());
    expect(reviewReceipt).toHaveBeenCalledTimes(2);
    expect(reviewReceipt.mock.calls[1]?.[0]).toMatchObject({
      id: 'receipt-2',
      receiptDate: '2026-09-03',
      totalAmount: 4400,
    });
  });

  it.each(['saving success', 'saving rejection', 'refreshing success'])(
    'does not let a late %s alter or navigate the next receipt on the reused route',
    async (phase) => {
      const finish = gate(false);
      if (phase === 'refreshing success') {
        observeList(
          ['finance', 'receipts', 'pendingApprovalGrouped'],
          'route-sibling',
          async () => {
            await finish.promise;
            return ['current'];
          },
        );
      } else {
        reviewReceipt.mockImplementationOnce(async (input) => {
          await finish.promise;
          if (phase === 'saving rejection')
            throw new Error('Old receipt response lost');
          return { id: input.id, status: input.status };
        });
      }
      const action = ownAction(fixture.componentInstance['approve']());
      await vi.waitFor(() => {
        expect(reviewReceipt).toHaveBeenCalledTimes(1);
        expect(fixture.componentInstance['reviewPhase']()).toBe(
          phase === 'refreshing success' ? 'refreshing' : 'saving',
        );
      });
      findReceipt.mockImplementation(async (id) => ({
        ...approvalReceipt,
        id,
        totalAmount: 4400,
      }));
      routeParameters.next(convertToParamMap({ receiptId: 'receipt-2' }));
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(editedFields().totalAmount).toBe(44);
        expect(fixture.componentInstance['receiptQuery'].data()?.id).toBe(
          'receipt-2',
        );
      });
      fixture.componentInstance['form'].controls.totalAmount.setValue(45);
      if (phase !== 'refreshing success') {
        expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
          'pending',
        );
        expect(fixture.componentInstance['reviewMutation'].isPending()).toBe(
          true,
        );
        expect(approvalButton(fixture, 'Approve').disabled).toBe(true);
        await ownAction(fixture.componentInstance['approve']());
        expect(reviewReceipt).toHaveBeenCalledTimes(1);
      }
      finish.resolve(true);
      await action;
      expect(queryClient.getMutationCache().getAll()).toHaveLength(1);
      expect(queryClient.getMutationCache().getAll()[0]?.state.status).toBe(
        phase === 'saving rejection' ? 'error' : 'success',
      );
      expect(
        queryClient.getQueryState(receiptQueryKey('receipt-2')),
      ).toMatchObject({
        data: { id: 'receipt-2', totalAmount: 4400 },
        fetchStatus: 'idle',
        isInvalidated: false,
        status: 'success',
      });
      // The real cache settles before Angular receives its batched notification.
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(fixture.componentInstance['reviewMutation'].isPending()).toBe(
          false,
        );
        expect(fixture.componentInstance['reviewMutation'].status()).toBe(
          phase === 'saving rejection' ? 'error' : 'success',
        );
        expect(fixture.componentInstance['receiptQuery'].isSuccess()).toBe(
          true,
        );
        expect(fixture.componentInstance['receiptQuery'].isFetching()).toBe(
          false,
        );
        expect(fixture.componentInstance['form'].enabled).toBe(true);
        expect(fixture.componentInstance['form'].valid).toBe(true);
        expect(approvalButton(fixture, 'Approve').disabled).toBe(false);
      });
      fixture.detectChanges();
      expect(reviewReceipt.mock.calls[0]?.[0].id).toBe('receipt-1');
      expect(editedFields().totalAmount).toBe(45);
      expect(fixture.componentInstance['reviewPhase']()).toBe('idle');
      expect(fixture.componentInstance['reviewMessage']()).toBeNull();
      expect(approvalButton(fixture, 'Approve').disabled).toBe(false);
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      expect(notifications.showError).not.toHaveBeenCalled();
      expect(notifications.showSuccess).not.toHaveBeenCalled();
    },
  );

  it.each(['saving success', 'saving rejection', 'refreshing success'])(
    'settles a late %s without messages or navigation after the detail is destroyed',
    async (phase) => {
      const finish = gate(false);
      const listRead = vi.fn(async () => {
        if (phase === 'refreshing success') await finish.promise;
        return ['current'];
      });
      observeList(
        ['finance', 'receipts', 'pendingApprovalGrouped'],
        'destroyed-detail',
        listRead,
      );
      if (phase !== 'refreshing success') {
        reviewReceipt.mockImplementationOnce(async (input) => {
          await finish.promise;
          if (phase === 'saving rejection')
            throw new Error('Response lost after leaving the detail');
          return { id: input.id, status: input.status };
        });
      }
      const component = fixture.componentInstance;
      const action = ownAction(component['approve']());
      await vi.waitFor(() => {
        expect(reviewReceipt).toHaveBeenCalledTimes(1);
        expect(component['reviewPhase']()).toBe(
          phase === 'refreshing success' ? 'refreshing' : 'saving',
        );
      });
      const previousPhase = component['reviewPhase']();
      const previousMessage = component['reviewMessage']();
      fixture.destroy();
      cleanupFixture = undefined;
      expect(fixture.componentRef.hostView.destroyed).toBe(true);

      finish.resolve(true);
      await action;

      expect(reviewReceipt).toHaveBeenCalledTimes(1);
      expect(reviewReceipt.mock.calls[0]?.[0].id).toBe('receipt-1');
      expect(listRead).toHaveBeenCalledTimes(
        phase === 'saving rejection' ? 0 : 1,
      );
      expect(component['reviewPhase']()).toBe(previousPhase);
      expect(component['reviewMessage']()).toBe(previousMessage);
      expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
      expect(notifications.showError).not.toHaveBeenCalled();
      expect(notifications.showSuccess).not.toHaveBeenCalled();
    },
  );

  it('completes the captured receipt after successful navigation destroys its detail', async () => {
    const navigate = vi.mocked(TestBed.inject(Router).navigate);
    navigate.mockImplementation(async () => {
      fixture.destroy();
      cleanupFixture = undefined;
      return true;
    });

    await ownAction(fixture.componentInstance['approve']());

    expect(fixture.componentRef.hostView.destroyed).toBe(true);
    expect(reviewReceipt).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledExactlyOnceWith([
      '/finance/receipts-approval',
    ]);
    expect(queryClient.getQueryData(approvalReceiptKey)).toBeUndefined();
    expect(notifications.showError).not.toHaveBeenCalled();
    expect(notifications.showSuccess).toHaveBeenCalledExactlyOnceWith(
      receiptReviewSuccessMessage('approved'),
    );
  });
});
