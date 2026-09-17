import type { FinanceTransactionRecord } from '@shared/rpc-contracts/app-rpcs/finance.rpcs';

import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatPaginatorHarness } from '@angular/material/paginator/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import {
  TransactionListComponent,
  TransactionListQueries,
  transactionMethodLabel,
  transactionStatusLabel,
} from './transaction-list.component';

const transactionListTemplate = () =>
  readFileSync(
    path.join(
      process.cwd(),
      'src/app/finance/transaction-list/transaction-list.component.html',
    ),
    'utf8',
  );

describe('TransactionListComponent template', () => {
  it('does not advertise manual transaction creation without an implemented route', () => {
    const template = transactionListTemplate();

    expect(template).not.toContain('Create transaction');
    expect(template).not.toContain('routerLink="edit"');
  });

  it('formats recorded amounts with each transaction currency', () => {
    const template = transactionListTemplate();

    expect(template.match(/currency: element\.currency/g)).toHaveLength(4);
  });

  it('labels the paginator for transactions rather than users', () => {
    expect(transactionListTemplate()).toContain(
      'aria-label="Select page of payments and refunds"',
    );
  });

  it('keeps database terminology out of visible payment history copy', () => {
    const template = transactionListTemplate();

    expect(template).not.toMatch(/>\s*[^<{]*transactions?[^<{]*</iu);
    expect(template).toContain('Payment history');
  });
});

describe('transaction labels', () => {
  it('uses readable payment method and transaction status labels', () => {
    expect(transactionMethodLabel).toEqual({
      cash: 'Cash',
      paypal: 'PayPal',
      stripe: 'Online payment',
      transfer: 'Bank transfer',
    });
    expect(transactionStatusLabel).toEqual({
      cancelled: 'Cancelled',
      pending: 'Pending',
      successful: 'Completed',
    });
  });
});

const findTransactions = vi.fn();

const normalizeText = (fixture: ComponentFixture<TransactionListComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('TransactionListComponent load recovery', () => {
  let queryClient: QueryClient;
  let cleanupClient: QueryClient | undefined;

  beforeEach(async () => {
    cleanupClient = undefined;
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    cleanupClient = queryClient;
    await TestBed.configureTestingModule({
      imports: [TransactionListComponent],
      providers: [
        provideTanStackQuery(queryClient),
        {
          provide: TENANT_DATE_PIPE_TIMEZONE,
          useValue: 'Europe/Berlin',
        },
        {
          provide: TransactionListQueries,
          useValue: {
            findMany: (filter: object) => ({
              queryFn: findTransactions,
              queryKey: ['transactions', filter],
            }),
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    const ownedClient = cleanupClient;
    cleanupClient = undefined;
    const failures: unknown[] = [];
    for (const cleanup of [
      () => ownedClient?.clear(),
      () => vi.clearAllMocks(),
      () => TestBed.resetTestingModule(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Transaction fixture cleanup failed', {
        cause: failures[0],
      });
  });

  it('announces a failed first load and retries the transaction query', async () => {
    findTransactions
      .mockRejectedValueOnce(new Error('Transactions unavailable'))
      .mockResolvedValue({
        data: [
          {
            amount: 2500,
            appFee: 0,
            comment: 'Event registration',
            createdAt: '2026-07-10T10:00:00.000Z',
            currency: 'CZK',
            id: 'transaction-1',
            method: 'transfer',
            status: 'successful',
            stripeFee: 0,
          },
        ],
        total: 1,
      });

    const fixture = TestBed.createComponent(TransactionListComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'Payment history could not be loaded',
      );
    });

    const alert: HTMLElement | null =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      'No payments or refunds are shown. Select Try again.',
    );

    const retryButton: HTMLButtonElement | null =
      fixture.nativeElement.querySelector('button');
    expect(retryButton?.textContent?.trim()).toBe('Try again');
    retryButton?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Event registration');
    });
    expect(findTransactions).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('shows readable method, status, and fee details in the table', async () => {
    findTransactions.mockResolvedValue({
      data: [
        {
          amount: 5000,
          appFee: 250,
          comment: 'Event registration',
          createdAt: '2026-07-10T10:00:00.000Z',
          currency: 'EUR',
          id: 'transaction-1',
          method: 'stripe',
          status: 'successful',
          stripeFee: 120,
        },
      ],
      total: 1,
    });

    const fixture = TestBed.createComponent(TransactionListComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      const text = normalizeText(fixture);
      expect(text).toContain('Completed');
      expect(text).toContain('Online payment');
      expect(text).not.toContain('Stripe');
      expect(text).toContain('Fees:');
      expect(text).toContain('Evorto fee:');
      expect(text).toContain('Payment fee:');
    });
  });

  it('explains when no transactions have been recorded', async () => {
    findTransactions.mockResolvedValue({ data: [], total: 0 });

    const fixture = TestBed.createComponent(TransactionListComponent);
    fixture.detectChanges();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain(
        'No payments or refunds recorded yet',
      );
    });
    expect(fixture.nativeElement.querySelector('table')).toBeNull();
    expect(fixture.nativeElement.querySelector('mat-paginator')).toBeNull();
  });

  it('preserves page size and position after an uncached page loads', async () => {
    const pageResult = {
      data: [
        {
          amount: 100,
          appFee: 0,
          comment: 'Paged payment',
          createdAt: '2026-07-10T10:00:00.000Z',
          currency: 'EUR',
          id: 'payment-1',
          method: 'transfer',
          status: 'successful',
          stripeFee: 0,
        },
      ],
      total: 300,
    } satisfies { data: FinanceTransactionRecord[]; total: number };
    findTransactions.mockResolvedValue(pageResult);
    const fixture = TestBed.createComponent(TransactionListComponent);
    const failures: unknown[] = [];
    let resolvePage: ((value: typeof pageResult) => void) | undefined;
    try {
      fixture.detectChanges();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(normalizeText(fixture)).toContain('Paged payment');
      });
      const loader = TestbedHarnessEnvironment.loader(fixture);
      const initialPaginator = await loader.getHarness(MatPaginatorHarness);
      await initialPaginator.setPageSize(25);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(findTransactions).toHaveBeenLastCalledWith(
          expect.objectContaining({
            queryKey: ['transactions', { limit: 25, offset: 0 }],
          }),
        );
        expect(normalizeText(fixture)).toContain('Paged payment');
      });

      // Angular's browser library target does not expose Promise.withResolvers.
      // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
      const nextPage = new Promise<typeof pageResult>((resolve) => {
        resolvePage = resolve;
      });
      findTransactions.mockReturnValueOnce(nextPage);
      const root: HTMLElement = fixture.nativeElement;
      const nextButton = root.querySelector<HTMLButtonElement>(
        '.mat-mdc-paginator-navigation-next',
      );
      if (!nextButton)
        throw new Error('Expected the next transaction page control');
      nextButton.click();
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(normalizeText(fixture)).toContain('Loading payment history');
        expect(root.querySelector('mat-paginator')).toBeNull();
      });
      resolvePage?.(pageResult);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(normalizeText(fixture)).toContain('Paged payment');
      });
      const paginator = await loader.getHarness(MatPaginatorHarness);
      expect(await paginator.getPageSize()).toBe(25);
      expect(await paginator.getRangeLabel()).toMatch(/26\s*[–-]\s*50/u);
      await paginator.goToNextPage();
      expect(findTransactions).toHaveBeenLastCalledWith(
        expect.objectContaining({
          queryKey: ['transactions', { limit: 25, offset: 50 }],
        }),
      );
    } catch (error) {
      failures.push(error);
    }
    for (const cleanup of [
      () => resolvePage?.(pageResult),
      async () => {
        await queryClient.cancelQueries({ queryKey: ['transactions'] });
      },
      () => fixture.destroy(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Paged transaction assertion or cleanup failed',
        { cause: failures[0] },
      );
  });
});
