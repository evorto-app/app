import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TransactionListComponent,
  TransactionListQueries,
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
});

const findTransactions = vi.fn();

const normalizeText = (fixture: ComponentFixture<TransactionListComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('TransactionListComponent load recovery', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    await TestBed.configureTestingModule({
      imports: [TransactionListComponent],
      providers: [
        provideTanStackQuery(queryClient),
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
    queryClient.clear();
    vi.clearAllMocks();
    TestBed.resetTestingModule();
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
            createdAt: new Date('2026-07-10T10:00:00.000Z'),
            currency: 'CZK',
            id: 'transaction-1',
            method: 'transfer',
            status: 'completed',
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
        'Transactions could not be loaded',
      );
    });

    const alert: HTMLElement | null =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(
      'The transaction history is unavailable. Check your connection and try again.',
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
});
