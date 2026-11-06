import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import {
  focusProfileDetailHeading,
  profileChildPageActive,
  ProfileShellComponent,
} from './profile-shell.component';

describe('profile shell route behavior', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('distinguishes the overview from routed detail pages', () => {
    expect(profileChildPageActive(undefined)).toBe(false);
    expect(profileChildPageActive('')).toBe(false);
    expect(profileChildPageActive('events')).toBe(true);
  });

  it('moves focus to the routed detail heading', () => {
    const content = document.createElement('main');
    const heading = document.createElement('h1');
    heading.id = 'profile-detail-heading';
    heading.tabIndex = -1;
    content.append(heading);
    document.body.append(content);

    focusProfileDetailHeading(content);

    expect(document.activeElement).toBe(heading);
  });

  it('surfaces a missing detail heading contract', () => {
    const content = document.createElement('main');

    expect(() => focusProfileDetailHeading(content)).toThrowError(
      'Profile detail routes must render #profile-detail-heading.',
    );
  });
});

describe('Profile receipt navigation', () => {
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
    status: 'submitted',
    submittedByUserId: 'user-1',
    taxAmount: 200,
    totalAmount: 1250,
    updatedAt: '2030-01-02T12:00:00.000Z',
  };
  let queryClient: QueryClient;

  afterEach(() => {
    queryClient?.clear();
    TestBed.resetTestingModule();
  });

  it.each(['empty', 'with-receipts', 'error'] as const)(
    'offers receipt navigation only when useful: %s',
    async (state) => {
      queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const readReceipts = vi.fn<() => Promise<Receipts>>();
      if (state === 'error')
        readReceipts.mockRejectedValue(new Error('Unavailable'));
      else readReceipts.mockResolvedValue(state === 'empty' ? [] : [receipt]);
      const options: ReturnType<
        Client['finance']['receipts']['my']['queryOptions']
      > = {
        queryFn: readReceipts,
        queryKey: [['finance', 'receipts', 'my'], { type: 'query' }],
      };
      await TestBed.configureTestingModule({
        imports: [ProfileShellComponent],
        providers: [
          provideRouter([]),
          provideTanStackQuery(queryClient),
          { provide: ConfigService, useValue: { tenantSignal: signal(null) } },
          {
            provide: APP_RPC_CLIENT,
            useValue: {
              finance: { receipts: { my: { queryOptions: () => options } } },
            },
          },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(ProfileShellComponent);
      await vi.waitFor(() => {
        fixture.detectChanges();
        expect(queryClient.getQueryState(options.queryKey)?.status).toBe(
          state === 'error' ? 'error' : 'success',
        );
        const link: HTMLAnchorElement | null =
          fixture.nativeElement.querySelector(':scope a[href$="/receipts"]');
        expect(Boolean(link)).toBe(state !== 'empty');
      });
    },
  );
});
