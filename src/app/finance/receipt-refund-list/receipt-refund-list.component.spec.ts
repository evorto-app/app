import '@angular/compiler';
import type {
  FinanceReceiptRefundGroupRecord,
  FinanceReceiptsCreateRefund,
} from '@shared/rpc-contracts/app-rpcs/finance.rpcs';
import type { MutationFunctionContext } from '@tanstack/angular-query-experimental';
import type { Schema } from 'effect';

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  MatDialog,
  MatDialogModule,
  MatDialogState,
} from '@angular/material/dialog';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { NotificationService } from '../../core/notification.service';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import { isSafeReceiptPreviewUrl } from '../shared/receipt-preview-dialog/receipt-preview-dialog.component';
import {
  ReceiptRefundListComponent,
  receiptReimbursementCanRecord,
  receiptReimbursementConfirmationData,
  receiptReimbursementGroupKey,
  receiptReimbursementHasPayoutDetails,
  receiptReimbursementManualNotice,
  receiptReimbursementMissingPayoutNotice,
  receiptReimbursementPayoutDetailLabel,
  receiptReimbursementReceiptSelectionLabel,
  receiptReimbursementRecordDisabled,
  receiptReimbursementSelectAllLabel,
  receiptReimbursementSelectedTotal,
} from './receipt-refund-list.component';

describe('isSafeReceiptPreviewUrl', () => {
  it('allows app-relative and trusted signed HTTP preview URLs', () => {
    expect(isSafeReceiptPreviewUrl('/receipt-preview/file.pdf')).toBe(true);
    expect(
      isSafeReceiptPreviewUrl(
        'https://receipt-bucket.s3.fr-par.scw.cloud/signed/file.pdf?token=abc',
      ),
    ).toBe(true);
    expect(isSafeReceiptPreviewUrl('http://localhost:9000/receipt.pdf')).toBe(
      true,
    );
  });

  it('rejects non-network preview URLs before they can be trusted for rendering', () => {
    expect(isSafeReceiptPreviewUrl(null)).toBe(false);
    expect(isSafeReceiptPreviewUrl('javascript:alert(1)')).toBe(false);
    expect(
      isSafeReceiptPreviewUrl('data:application/pdf;base64,JVBERi0='),
    ).toBe(false);
    expect(isSafeReceiptPreviewUrl('local-unavailable://receipt')).toBe(false);
    expect(isSafeReceiptPreviewUrl('https://evil.example.test/receipt')).toBe(
      false,
    );
    expect(
      isSafeReceiptPreviewUrl('https://objects.example.test/receipt.pdf'),
    ).toBe(false);
  });
});

describe('receiptReimbursementManualNotice', () => {
  it('keeps reimbursement copy honest about manual money movement', () => {
    expect(receiptReimbursementManualNotice).toBe(
      'This only records that you paid the reimbursement. Evorto does not transfer the money.',
    );
  });
});

describe('receiptReimbursementCanRecord', () => {
  it('requires at least one selected receipt', () => {
    expect(
      receiptReimbursementCanRecord(
        [],
        { iban: 'DE123', paypalEmail: null },
        'iban',
      ),
    ).toBe(false);
  });

  it('requires the selected payout detail to exist', () => {
    expect(
      receiptReimbursementCanRecord(
        ['receipt-1'],
        { iban: null, paypalEmail: 'pay@example.com' },
        'iban',
      ),
    ).toBe(false);
    expect(
      receiptReimbursementCanRecord(
        ['receipt-1'],
        { iban: null, paypalEmail: 'pay@example.com' },
        'paypal',
      ),
    ).toBe(true);
  });

  it('bounds each reimbursement to 100 receipts', () => {
    expect(
      receiptReimbursementCanRecord(
        Array.from({ length: 101 }, (_, index) => `receipt-${index}`),
        { iban: 'DE123', paypalEmail: null },
        'iban',
      ),
    ).toBe(false);
  });
});

describe('receiptReimbursementConfirmationData', () => {
  it('shows the exact manual payout that will be recorded', () => {
    expect(
      receiptReimbursementConfirmationData({
        currency: 'EUR',
        payoutDestination: 'DE123',
        payoutType: 'iban',
        receiptCount: 2,
        recipientEmail: 'ada@example.test',
        recipientFirstName: 'Ada',
        recipientLastName: 'Lovelace',
        totalAmount: 4200,
      }),
    ).toEqual({
      currency: 'EUR',
      payoutDestination: 'DE123',
      payoutMethod: 'Bank transfer',
      receiptCount: 2,
      recipient: 'Ada Lovelace',
      totalAmount: 4200,
    });
  });
});

describe('receiptReimbursementHasPayoutDetails', () => {
  it('reports whether the recipient has at least one usable payout method', () => {
    expect(
      receiptReimbursementHasPayoutDetails({
        iban: null,
        paypalEmail: null,
      }),
    ).toBe(false);
    expect(
      receiptReimbursementHasPayoutDetails({
        iban: 'DE123',
        paypalEmail: null,
      }),
    ).toBe(true);
    expect(receiptReimbursementMissingPayoutNotice).toContain(
      'before recording a reimbursement',
    );
  });
});

describe('receipt reimbursement selection labels', () => {
  it('identifies the recipient, currency, receipt, and event for checkbox controls', () => {
    expect(
      receiptReimbursementSelectAllLabel({
        currency: 'EUR',
        submittedByFirstName: 'Ada',
        submittedByLastName: 'Lovelace',
      }),
    ).toBe('Select all EUR receipts for Ada Lovelace');
    expect(
      receiptReimbursementReceiptSelectionLabel({
        attachmentFileName: 'receipt.pdf',
        eventTitle: 'Welcome Week',
      }),
    ).toBe('Select receipt receipt.pdf for Welcome Week');
  });
});

describe('receiptReimbursementRecordDisabled', () => {
  it('disables reimbursement recording when the selected group cannot be recorded', () => {
    expect(
      receiptReimbursementRecordDisabled({
        canRecord: false,
        mutationPending: false,
      }),
    ).toBe(true);
  });

  it('disables reimbursement recording while a refund mutation is pending', () => {
    expect(
      receiptReimbursementRecordDisabled({
        canRecord: true,
        mutationPending: true,
      }),
    ).toBe(true);
  });

  it('allows reimbursement recording only when the selection and mutation are ready', () => {
    expect(
      receiptReimbursementRecordDisabled({
        canRecord: true,
        mutationPending: false,
      }),
    ).toBe(false);
  });
});

describe('receiptReimbursementPayoutDetailLabel', () => {
  it('labels configured and missing payout details', () => {
    expect(receiptReimbursementPayoutDetailLabel('iban', 'DE123')).toBe(
      'IBAN: DE123',
    );
    expect(receiptReimbursementPayoutDetailLabel('paypal', null)).toBe(
      'PayPal: not set',
    );
  });
});

describe('receiptReimbursementSelectedTotal', () => {
  it('sums only selected receipt rows', () => {
    expect(
      receiptReimbursementSelectedTotal(
        [
          { id: 'receipt-1', totalAmount: 1299 },
          { id: 'receipt-2', totalAmount: 2500 },
          { id: 'receipt-3', totalAmount: 999 },
        ],
        ['receipt-1', 'receipt-3'],
      ),
    ).toBe(2298);
  });
});

describe('receiptReimbursementGroupKey', () => {
  it("keeps one recipient's reimbursement state separate per currency", () => {
    expect(
      receiptReimbursementGroupKey({
        currency: 'EUR',
        submittedByUserId: 'user-1',
      }),
    ).not.toBe(
      receiptReimbursementGroupKey({
        currency: 'CZK',
        submittedByUserId: 'user-1',
      }),
    );
  });
});

type RefundPayload = Schema.Schema.Type<
  typeof FinanceReceiptsCreateRefund.payloadSchema
>;
type RefundResult = Schema.Schema.Type<
  typeof FinanceReceiptsCreateRefund.successSchema
>;

const refundGroup: FinanceReceiptRefundGroupRecord = {
  currency: 'EUR',
  payout: {
    iban: 'DE89370400440532013000',
    paypalEmail: 'payout@example.test',
  },
  receipts: [
    {
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
      recipientIban: 'DE89370400440532013000',
      recipientPaypalEmail: 'payout@example.test',
      refundedAt: null,
      refundTransactionId: null,
      rejectionReason: null,
      reviewedAt: '2026-09-01T11:00:00Z',
      status: 'approved',
      submittedByEmail: 'ada@example.test',
      submittedByFirstName: 'Ada',
      submittedByLastName: 'Lovelace',
      submittedByUserId: 'user-1',
      taxAmount: 100,
      totalAmount: 1299,
      updatedAt: '2026-09-01T11:00:00Z',
    },
  ],
  submittedByEmail: 'ada@example.test',
  submittedByFirstName: 'Ada',
  submittedByLastName: 'Lovelace',
  submittedByUserId: 'user-1',
  totalAmount: 1299,
};
const refundResult: RefundResult = {
  receiptCount: 1,
  totalAmount: 1299,
  transactionId: 'transaction-1',
};
const refundPath = ['finance', 'receipts', 'createRefund'];
const refundablePath = ['finance', 'receipts', 'refundableGroupedByRecipient'];
const refundableKey = createRpcQueryKey(refundablePath, {
  keyPrefix: 'rpc',
  type: 'query',
});
const refundListPaths = [
  ['finance', 'receipts', 'refundableGroupedByRecipient'],
  ['finance', 'receipts', 'pendingApprovalGrouped'],
  ['finance', 'transactions', 'findMany'],
];

const refundRoot = (
  fixture: ComponentFixture<ReceiptRefundListComponent>,
): HTMLElement => {
  const root: unknown = fixture.nativeElement;
  if (!(root instanceof HTMLElement))
    throw new Error('Missing reimbursement root');
  return root;
};

const refundButton = (
  fixture: ComponentFixture<ReceiptRefundListComponent>,
): HTMLButtonElement => {
  const button = [...refundRoot(fixture).querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.trim() === 'Record reimbursement',
  );
  if (!button) throw new Error('Missing Record reimbursement button');
  return button;
};

describe('receipt reimbursement component mutation outcomes', () => {
  let fixture: ComponentFixture<ReceiptRefundListComponent>;
  let queryClient: QueryClient;
  let cleanupQueryClient: QueryClient | undefined;
  let cleanupFixture: ComponentFixture<ReceiptRefundListComponent> | undefined;
  let releases: (() => void)[];
  let disposals: (() => void)[];
  let actions: Promise<PromiseSettledResult<void>>[];
  let actionSettlements: PromiseSettledResult<void>[];
  const findGroups =
    vi.fn<() => Promise<readonly FinanceReceiptRefundGroupRecord[]>>();
  const createRefund =
    vi.fn<
      (
        input: RefundPayload,
        context: MutationFunctionContext,
      ) => Promise<RefundResult>
    >();
  const notifications = {
    showError: vi.fn<(message: string) => void>(),
    showSuccess: vi.fn<(message: string) => void>(),
  };
  const groupKey = receiptReimbursementGroupKey(refundGroup);

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

  const beginRefund = () => {
    const action = ownAction(
      fixture.componentInstance['refundRecipient'](refundGroup),
    );
    const reference = TestBed.inject(MatDialog).openDialogs[0];
    if (!reference) throw new Error('Missing owned reimbursement confirmation');
    releases.push(() => {
      if (reference.getState() === MatDialogState.OPEN) reference.close(false);
    });
    return { action, reference };
  };

  const expectRetained = () => {
    expect(fixture.componentInstance['selectedReceiptIds'](groupKey)).toEqual([
      'receipt-1',
    ]);
    expect(
      fixture.componentInstance['getPayoutType'](groupKey, refundGroup.payout),
    ).toBe('paypal');
    expect(fixture.componentInstance['refundGroups']()).toEqual([refundGroup]);
    expect(refundRoot(fixture).textContent).toContain('receipt.pdf');
    expect(
      refundRoot(fixture).querySelector('mat-select')?.textContent,
    ).toContain('PayPal');
  };

  beforeEach(async () => {
    cleanupFixture = undefined;
    cleanupQueryClient = undefined;
    releases = [];
    disposals = [];
    actions = [];
    actionSettlements = [];
    findGroups.mockReset().mockResolvedValue([refundGroup]);
    createRefund.mockReset().mockResolvedValue(refundResult);
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
      imports: [ReceiptRefundListComponent, MatDialogModule],
      providers: [
        provideNoopAnimations(),
        provideTanStackQuery(queryClient),
        { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
        { provide: NotificationService, useValue: notifications },
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
                      pathSegments: refundPath,
                    }),
                },
                refundableGroupedByRecipient: {
                  queryOptions: () =>
                    createRpcQueryOptions({
                      keyPrefix: 'rpc',
                      pathSegments: refundablePath,
                      queryFn: findGroups,
                      type: 'query',
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
    fixture = TestBed.createComponent(ReceiptRefundListComponent);
    cleanupFixture = fixture;
    fixture.detectChanges();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.componentInstance['refundGroups']()).toEqual([
        refundGroup,
      ]);
    });
    fixture.componentInstance['setPayoutType'](groupKey, 'paypal');
    fixture.componentInstance['toggleReceipt'](groupKey, 'receipt-1', true);
    fixture.detectChanges();
    expectRetained();
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
      throw new AggregateError(failures, 'Reimbursement test cleanup failed', {
        cause: failures[0],
      });
  });

  it('owns the confirmation lifetime and preserves the exact selected manual payout through cancellation', async () => {
    const { action, reference } = beginRefund();
    fixture.detectChanges();
    expect(fixture.componentInstance['refundPhase']()).toBe('confirming');
    expect(refundButton(fixture).disabled).toBe(true);
    expect(
      refundRoot(fixture)
        .querySelector('mat-select')
        ?.getAttribute('aria-disabled'),
    ).toBe('true');
    const checkboxes = [
      ...refundRoot(fixture).querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      ),
    ];
    expect(checkboxes).toHaveLength(2);
    for (const checkbox of checkboxes) expect(checkbox.disabled).toBe(true);
    expect(
      refundRoot(fixture).querySelector('[role="status"]')?.textContent,
    ).toContain('open reimbursement confirmation');
    expect(document.body.textContent).toContain('PayPal · payout@example.test');
    expect(document.body.textContent).toContain('Ada Lovelace');
    expect(document.body.textContent).toContain(
      'Evorto does not send the money',
    );
    await ownAction(fixture.componentInstance['refundRecipient'](refundGroup));
    expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(1);
    fixture.componentInstance['setPayoutType'](groupKey, 'iban');
    fixture.componentInstance['toggleReceipt'](groupKey, 'receipt-1', false);
    fixture.componentInstance['toggleAllReceipts'](
      groupKey,
      ['receipt-1'],
      false,
    );
    expectRetained();
    expect(createRefund).not.toHaveBeenCalled();
    reference.close(false);
    await action;
    fixture.detectChanges();
    expect(refundButton(fixture).disabled).toBe(false);
    expectRetained();
    expect(createRefund).not.toHaveBeenCalled();
  });

  it('reports a confirmation failure as pre-write and leaves the selection editable', async () => {
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockImplementation(() => {
      throw new Error('Dialog unavailable');
    });
    await ownAction(fixture.componentInstance['refundRecipient'](refundGroup));
    fixture.detectChanges();
    expect(createRefund).not.toHaveBeenCalled();
    expect(fixture.componentInstance['refundPhase']()).toBe('idle');
    expect(
      refundRoot(fixture).querySelector('[role="alert"]')?.textContent,
    ).toContain('No reimbursement was submitted');
    expectRetained();
  });

  it('submits the exact payload once and clears selection only after all actual canonical reads finish', async () => {
    const mutation = gate(refundResult);
    const transactions = gate(['recorded']);
    createRefund.mockReturnValue(mutation.promise);
    const readTransactions = vi.fn(() => transactions.promise);
    const readPending = vi.fn(async () => ['current']);
    observeList(
      ['finance', 'transactions', 'findMany'],
      'active',
      readTransactions,
    );
    observeList(
      ['finance', 'receipts', 'pendingApprovalGrouped'],
      'active',
      readPending,
    );
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { action, reference } = beginRefund();
    reference.close(true);
    await vi.waitFor(() => expect(createRefund).toHaveBeenCalledTimes(1));
    fixture.detectChanges();
    expect(createRefund).toHaveBeenCalledExactlyOnceWith(
      {
        payoutReference: 'payout@example.test',
        payoutType: 'paypal',
        receiptIds: ['receipt-1'],
      },
      {
        client: queryClient,
        meta: { rpc: { path: refundPath } },
        mutationKey: createRpcQueryKey(refundPath, {
          keyPrefix: 'rpc',
          type: 'mutation',
        }),
      },
    );
    expect(
      refundRoot(fixture).querySelector('[role="status"]')?.textContent,
    ).toContain('Recording the reimbursement');
    expect(invalidate).not.toHaveBeenCalled();
    expectRetained();
    findGroups.mockResolvedValue([]);
    mutation.resolve(refundResult);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(readTransactions).toHaveBeenCalledTimes(1);
      expect(readPending).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryData(refundableKey)).toEqual([]);
      expect(fixture.componentInstance['refundMutation'].isPending()).toBe(
        false,
      );
    });
    expect(fixture.componentInstance['refundPhase']()).toBe('refreshing');
    expect(
      refundRoot(fixture).querySelector('[role="status"]')?.textContent,
    ).toContain('Reimbursement recorded. Loading');
    expect(refundButton(fixture).disabled).toBe(true);
    expectRetained();
    expect(notifications.showSuccess).not.toHaveBeenCalled();
    await ownAction(fixture.componentInstance['refundRecipient'](refundGroup));
    expect(createRefund).toHaveBeenCalledTimes(1);
    transactions.resolve(['recorded']);
    await action;
    fixture.detectChanges();
    for (const path of refundListPaths) {
      expect(invalidate).toHaveBeenCalledWith(
        createRpcQueryFilter(path, { keyPrefix: 'rpc' }),
        { throwOnError: true },
      );
    }
    expect(findGroups).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance['selectedReceiptIds'](groupKey)).toEqual(
      [],
    );
    expect(
      fixture.componentInstance['getPayoutType'](groupKey, refundGroup.payout),
    ).toBe('paypal');
    expect(fixture.componentInstance['refundGroups']()).toEqual([]);
    expect(refundRoot(fixture).textContent).toContain(
      'No approved receipts are waiting',
    );
    expect(notifications.showSuccess).toHaveBeenCalledExactlyOnceWith(
      'Reimbursement recorded',
    );
  });

  it.each([
    new RpcBadRequestError({ message: 'Choose an available payout method.' }),
    new FinanceReceiptNotFoundError({
      message: 'This receipt no longer exists.',
    }),
    new FinanceResourceNotFoundError({
      message: 'This recipient no longer exists.',
    }),
    new ReceiptMediaBadRequestError({
      message: 'The receipt evidence is invalid.',
    }),
    new ReceiptMediaServiceUnavailableError({
      message: 'Receipt evidence is temporarily unavailable.',
    }),
  ])(
    'retains selection and permits correction after expected $_tag denial',
    async (error) => {
      createRefund.mockRejectedValue(error);
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      const { action, reference } = beginRefund();
      reference.close(true);
      await action;
      fixture.detectChanges();
      expect(notifications.showError).toHaveBeenCalledExactlyOnceWith(
        error.message,
      );
      expect(refundButton(fixture).disabled).toBe(false);
      expect(fixture.componentInstance['refundPhase']()).toBe('idle');
      expect(createRefund).toHaveBeenCalledTimes(1);
      expect(invalidate).not.toHaveBeenCalled();
      expectRetained();
    },
  );

  it.each([
    [
      new RpcUnauthorizedError({ message: 'private authorization detail' }),
      'Sign in again before recording this reimbursement.',
    ],
    [
      new RpcForbiddenError({ message: 'private permission detail' }),
      'You do not have access to record this reimbursement. Check your active section and permissions.',
    ],
  ])(
    'maps a known access denial to safe corrective copy',
    async (error, message) => {
      createRefund.mockRejectedValue(error);
      const { action, reference } = beginRefund();
      reference.close(true);
      await action;
      fixture.detectChanges();
      expect(notifications.showError).toHaveBeenCalledExactlyOnceWith(message);
      expect(fixture.componentInstance['refundPhase']()).toBe('idle');
      expect(refundRoot(fixture).textContent).not.toContain('private');
      expectRetained();
    },
  );

  it.each(['lost response', 'internal error'])(
    'does not retry or erase selection after an unconfirmed %s',
    async (failure) => {
      let committed = false;
      createRefund.mockImplementation(async () => {
        committed = true;
        throw failure === 'lost response'
          ? new Error('Connection lost after commit')
          : new RpcInternalServerError({ message: 'private database detail' });
      });
      const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
      const { action, reference } = beginRefund();
      reference.close(true);
      await action;
      fixture.detectChanges();
      expect(committed).toBe(true);
      expect(
        refundRoot(fixture).querySelector('[role="alert"]')?.textContent,
      ).toContain('outcome could not be confirmed');
      expect(refundButton(fixture).disabled).toBe(true);
      await ownAction(
        fixture.componentInstance['refundRecipient'](refundGroup),
      );
      expect(createRefund).toHaveBeenCalledTimes(1);
      expect(TestBed.inject(MatDialog).openDialogs).toHaveLength(0);
      expect(invalidate).not.toHaveBeenCalled();
      expect(notifications.showSuccess).not.toHaveBeenCalled();
      expectRetained();
    },
  );

  it('retains a confirmed reimbursement and visible selection when the active receipt read fails', async () => {
    const readFailure = new Error('Receipt refresh failed');
    findGroups.mockRejectedValue(readFailure);
    const { action, reference } = beginRefund();
    reference.close(true);
    await action;
    expect(queryClient.getQueryState(refundableKey)).toMatchObject({
      data: [refundGroup],
      error: readFailure,
      fetchStatus: 'idle',
      status: 'error',
    });
    // Await the real observer notification without replacing the cache result.
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(
        fixture.componentInstance['refundableReceiptsQuery'].isError(),
      ).toBe(true);
      expect(
        fixture.componentInstance['refundableReceiptsQuery'].isFetching(),
      ).toBe(false);
    });
    fixture.detectChanges();
    expect(fixture.componentInstance['refundableReceiptsQuery'].isError()).toBe(
      true,
    );
    expect(
      refundRoot(fixture).querySelector('[role="alert"]')?.textContent,
    ).toContain('reimbursement was recorded');
    expect(fixture.componentInstance['refundPhase']()).toBe('saved');
    expect(refundButton(fixture).disabled).toBe(true);
    expect(notifications.showSuccess).not.toHaveBeenCalled();
    expectRetained();
    await ownAction(fixture.componentInstance['refundRecipient'](refundGroup));
    expect(createRefund).toHaveBeenCalledTimes(1);
  });

  it('waits for same-family and cross-family siblings after rejection while excluding disabled and static queries', async () => {
    const slow = gate(['current']);
    const transactions = gate(['recorded']);
    const failedRead = vi.fn(async (): Promise<string[]> => {
      throw new Error('Grouped receipt read failed');
    });
    const slowRead = vi.fn(() => slow.promise);
    const readTransactions = vi.fn(() => transactions.promise);
    const disabledRead = vi.fn(async () => ['disabled']);
    const staticRead = vi.fn(async () => ['static']);
    const failedKey = observeList(
      ['finance', 'receipts', 'refundableGroupedByRecipient'],
      'failed',
      failedRead,
    );
    const slowKey = observeList(
      ['finance', 'receipts', 'refundableGroupedByRecipient'],
      'slow',
      slowRead,
    );
    observeList(
      ['finance', 'transactions', 'findMany'],
      'active',
      readTransactions,
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
    findGroups.mockResolvedValue([]);
    const { action, reference } = beginRefund();
    reference.close(true);
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(queryClient.getQueryState(failedKey)?.status).toBe('error');
      expect(slowRead).toHaveBeenCalledTimes(1);
      expect(readTransactions).toHaveBeenCalledTimes(1);
      expect(queryClient.getQueryData(refundableKey)).toEqual([]);
      expect(fixture.componentInstance['refundMutation'].isPending()).toBe(
        false,
      );
    });
    expect(fixture.componentInstance['refundPhase']()).toBe('refreshing');
    expect(notifications.showError).not.toHaveBeenCalled();
    expect(notifications.showSuccess).not.toHaveBeenCalled();
    expect(refundButton(fixture).disabled).toBe(true);
    expectRetained();
    await ownAction(fixture.componentInstance['refundRecipient'](refundGroup));
    expect(createRefund).toHaveBeenCalledTimes(1);
    slow.resolve(['current']);
    await vi.waitFor(() =>
      expect(queryClient.getQueryState(slowKey)?.fetchStatus).toBe('idle'),
    );
    expect(fixture.componentInstance['refundPhase']()).toBe('refreshing');
    transactions.resolve(['recorded']);
    await action;
    fixture.detectChanges();
    expect(disabledRead).not.toHaveBeenCalled();
    expect(staticRead).not.toHaveBeenCalled();
    expect(fixture.componentInstance['refundPhase']()).toBe('saved');
    expect(
      refundRoot(fixture).querySelector('[role="alert"]')?.textContent,
    ).toContain('reimbursement was recorded');
    expectRetained();
    expect(notifications.showSuccess).not.toHaveBeenCalled();
  });
});
