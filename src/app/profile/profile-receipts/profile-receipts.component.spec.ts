import '@angular/compiler';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { createRpcQueryOptions } from '@heddendorp/effect-angular-query';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  APP_RPC_CLIENT,
  type AppRpc,
} from '../../core/effect-rpc-angular-client';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import { ProfileReceiptsComponent } from './profile-receipts.component';

describe('ProfileReceiptsComponent load recovery', () => {
  type Client = ReturnType<typeof AppRpc.injectClient>;
  type Receipts = Awaited<
    ReturnType<Client['finance']['receipts']['my']['call']>
  >;
  const receipt: Receipts[number] = {
    alcoholAmount: 0,
    attachmentFileName: 'workshop-supplies.pdf',
    attachmentMimeType: 'application/pdf',
    attachmentStorageKey: 'receipts/receipt-1.pdf',
    createdAt: '2030-01-02T12:00:00.000Z',
    currency: 'EUR',
    depositAmount: 0,
    eventId: 'event-1',
    eventStart: '2030-01-02T10:00:00.000Z',
    eventTitle: 'Member workshop',
    hasAlcohol: false,
    hasDeposit: false,
    id: 'receipt-1',
    previewImageUrl: null,
    purchaseCountry: 'DE',
    receiptDate: '2030-01-02',
    refundedAt: null,
    refundTransactionId: null,
    rejectionReason: null,
    reviewedAt: null,
    reviewedByFirstName: null,
    reviewedByLastName: null,
    status: 'submitted',
    submittedByUserId: 'user-1',
    submittedTotalAmount: null,
    taxAmount: 200,
    totalAmount: 1250,
    updatedAt: '2030-01-02T12:00:00.000Z',
  };
  const readReceipts = vi.fn<() => Promise<Receipts>>();
  let fixture: ComponentFixture<ProfileReceiptsComponent> | undefined;
  let queryClient: QueryClient;

  const rootElement = () => {
    const element: unknown = fixture?.nativeElement;
    if (!(element instanceof HTMLElement))
      throw new Error('Expected the actual profile receipts component.');
    return element;
  };
  const detectChanges = () => {
    if (!fixture) throw new Error('Expected a profile receipts fixture.');
    fixture.detectChanges();
  };
  const retryButton = () => {
    const button = rootElement().querySelector<HTMLButtonElement>(
      ':scope [role="alert"] button',
    );
    if (!button) throw new Error('Expected the receipt-load retry button.');
    return button;
  };
  const renderError = async () => {
    fixture = TestBed.createComponent(ProfileReceiptsComponent);
    await vi.waitFor(() => {
      detectChanges();
      expect(rootElement().textContent).toContain(
        "We couldn't load your receipts. Try again.",
      );
      expect(retryButton().textContent?.trim()).toBe('Try again');
      expect(retryButton().disabled).toBe(false);
      expect(readReceipts).toHaveBeenCalledOnce();
    });
    expect(rootElement().textContent).not.toContain('Private receipt error');
  };

  beforeEach(async () => {
    fixture = undefined;
    readReceipts
      .mockReset()
      .mockResolvedValue([])
      .mockRejectedValueOnce(new Error('Private receipt error'));
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    const options: ReturnType<
      Client['finance']['receipts']['my']['queryOptions']
    > = createRpcQueryOptions({
      pathSegments: ['finance', 'receipts', 'my'],
      queryFn: readReceipts,
      type: 'query',
    });
    await TestBed.configureTestingModule({
      imports: [ProfileReceiptsComponent],
      providers: [
        provideTanStackQuery(queryClient),
        { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            finance: { receipts: { my: { queryOptions: () => options } } },
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    const failures: unknown[] = [];
    for (const cleanup of [
      () => fixture?.destroy(),
      () => queryClient.clear(),
      () => TestBed.resetTestingModule(),
    ]) {
      try {
        cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, 'Profile receipts cleanup failed');
  });

  it.each([
    { label: 'a submitted receipt', result: [receipt] },
    { label: 'an empty receipt list', result: [] },
  ])(
    'keeps an explicit retry visible and disabled until it loads $label',
    async ({ result }) => {
      await renderError();
      let releaseRead: ((value: Receipts) => void) | undefined;
      // Angular's browser target does not expose Promise.withResolvers.
      // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
      const heldRead = new Promise<Receipts>((resolve) => {
        releaseRead = resolve;
      });
      readReceipts.mockReturnValueOnce(heldRead);
      const failures: unknown[] = [];
      try {
        retryButton().click();
        await vi.waitFor(() => {
          detectChanges();
          expect(readReceipts).toHaveBeenCalledTimes(2);
          expect(retryButton().disabled).toBe(true);
          expect(retryButton().textContent?.trim()).toBe('Loading receipts…');
          expect(
            rootElement()
              .querySelector('[role="alert"]')
              ?.getAttribute('aria-busy'),
          ).toBe('true');
        });
        // Also exercise the method guard behind the disabled native control.
        retryButton().dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await Promise.resolve();
        expect(readReceipts).toHaveBeenCalledTimes(2);
        expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
      } catch (error) {
        failures.push(error);
      } finally {
        releaseRead?.(result);
        await heldRead;
        try {
          await vi.waitFor(() => {
            detectChanges();
            expect(queryClient.isFetching()).toBe(0);
            expect(rootElement().querySelector('[role="alert"]')).toBeNull();
          });
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0)
        throw new AggregateError(failures, 'Receipt retry or cleanup failed');
      expect(readReceipts).toHaveBeenCalledTimes(2);
      expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
      if (result.length === 0) {
        expect(rootElement().textContent).toContain(
          'You have not submitted receipts yet.',
        );
        expect(rootElement().querySelector('article')).toBeNull();
      } else {
        expect(rootElement().querySelector('article')?.textContent).toContain(
          'workshop-supplies.pdf',
        );
        expect(rootElement().textContent).toContain('Member workshop');
        expect(rootElement().textContent).not.toContain(
          'You have not submitted receipts yet.',
        );
      }
    },
  );

  it('restores the explicit retry when the read fails again', async () => {
    await renderError();
    readReceipts.mockRejectedValueOnce(
      new Error('Private second receipt error'),
    );
    retryButton().click();
    await vi.waitFor(() => {
      detectChanges();
      expect(readReceipts).toHaveBeenCalledTimes(2);
      expect(retryButton().disabled).toBe(false);
      expect(retryButton().textContent?.trim()).toBe('Try again');
      expect(
        rootElement()
          .querySelector('[role="alert"]')
          ?.getAttribute('aria-busy'),
      ).toBeNull();
    });
    expect(rootElement().textContent).not.toContain(
      'Private second receipt error',
    );
    expect(rootElement().textContent).not.toContain(
      'You have not submitted receipts yet.',
    );
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
  });

  const renderReceipts = async (result: Receipts) => {
    readReceipts.mockReset().mockResolvedValue(result);
    fixture = TestBed.createComponent(ProfileReceiptsComponent);
    await vi.waitFor(() => {
      detectChanges();
      expect(rootElement().querySelector('article')).not.toBeNull();
    });
  };

  it('flags a changed amount and shows both amounts with the approver name', async () => {
    await renderReceipts([
      {
        ...receipt,
        reviewedAt: '2030-01-03T12:00:00.000Z',
        reviewedByFirstName: 'Grace',
        reviewedByLastName: 'Hopper',
        status: 'approved',
        submittedTotalAmount: 2000,
        totalAmount: 1250,
      },
    ]);
    const text = rootElement().textContent ?? '';
    expect(text).toContain('Amount changed');
    const details = rootElement().querySelector('details');
    expect(details?.textContent).toContain('Submitted amount');
    expect(details?.textContent).toContain('20.00');
    expect(details?.textContent).toContain('Approved amount');
    expect(details?.textContent).toContain('12.50');
    expect(details?.textContent).toContain('Approved by');
    expect(details?.textContent).toContain('Grace Hopper');
  });

  it.each([
    { label: 'equal', submittedTotalAmount: 1250 },
    { label: 'null', submittedTotalAmount: null },
  ])(
    'does not flag the amount when the submitted amount is $label',
    async ({ submittedTotalAmount }) => {
      await renderReceipts([{ ...receipt, submittedTotalAmount }]);
      expect(rootElement().textContent).not.toContain('Amount changed');
    },
  );

  it('does not flag a changed amount on a rejected receipt', async () => {
    await renderReceipts([
      {
        ...receipt,
        rejectionReason: 'Wrong event',
        reviewedAt: '2030-01-03T12:00:00.000Z',
        reviewedByFirstName: 'Grace',
        reviewedByLastName: 'Hopper',
        status: 'rejected',
        submittedTotalAmount: 2000,
        totalAmount: 1250,
      },
    ]);
    expect(rootElement().textContent).not.toContain('Amount changed');
    const details = rootElement().querySelector('details');
    expect(details?.textContent).toContain('Reviewed by');
    expect(details?.textContent).not.toContain('Approved amount');
  });

  it('shows the approver for a receipt reviewed before submitted amounts were kept', async () => {
    await renderReceipts([
      {
        ...receipt,
        reviewedAt: '2030-01-03T12:00:00.000Z',
        reviewedByFirstName: 'Grace',
        reviewedByLastName: 'Hopper',
        status: 'approved',
        submittedTotalAmount: null,
      },
    ]);
    expect(rootElement().textContent).not.toContain('Amount changed');
    const details = rootElement().querySelector('details');
    expect(details?.textContent).not.toContain('Submitted amount');
    expect(details?.textContent).toContain('Approved amount');
    expect(details?.textContent).toContain('Grace Hopper');
  });

  it('shows only the single amount without details when there is no submitted amount', async () => {
    await renderReceipts([receipt]);
    expect(rootElement().querySelector('details')).toBeNull();
    expect(rootElement().textContent).toContain('12.50');
  });
});
