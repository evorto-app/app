import type { EventsEventListDayRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/query-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { PermissionsService } from '../../core/permissions.service';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import {
  EVENT_LIST_PAGE_SIZE,
  eventListNextOffset,
  EventListService,
  mergeEventListPages,
} from '../event-list.service';
import { EventListComponent } from './event-list.component';

const eventQueryState = signal<'error' | 'success'>('error');
const hasNextPage = signal(false);
const nextPageError = signal(false);
const fetchNextPage = vi.fn(() => Promise.resolve());
const listedEvents: readonly EventsEventListDayRecord[] = [
  {
    day: '2030-01-02T00:00:00.000Z',
    events: [
      {
        icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
        id: 'event-1',
        start: '2030-01-02T10:00:00.000Z',
        status: 'APPROVED' as const,
        title: 'Recovery workshop',
        unlisted: false,
        userIsCreator: false,
        userRegistered: false,
      },
      {
        icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
        id: 'event-private',
        start: '2030-01-02T11:00:00.000Z',
        status: 'APPROVED',
        title: 'Private workshop',
        unlisted: true,
        userIsCreator: true,
        userRegistered: false,
      },
      {
        icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
        id: 'event-registered',
        start: '2030-01-02T12:00:00.000Z',
        status: 'APPROVED',
        title: 'Registered workshop',
        unlisted: false,
        userIsCreator: false,
        userRegistered: true,
      },
    ],
  },
];
const refetchEvents = vi.fn(async () => {
  eventQueryState.set('success');
});

const normalizeText = (fixture: ComponentFixture<EventListComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('EventListComponent load recovery', () => {
  beforeEach(async () => {
    eventQueryState.set('error');
    hasNextPage.set(false);
    nextPageError.set(false);
    fetchNextPage.mockClear();
    refetchEvents.mockClear();

    await TestBed.configureTestingModule({
      imports: [EventListComponent],
      providers: [
        provideRouter([]),
        { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
        {
          provide: ConfigService,
          useValue: { updateTitle: vi.fn() },
        },
        {
          provide: EventListService,
          useValue: {
            eventDays: () => listedEvents,
            eventQuery: {
              error: () => new Error('Events unavailable'),
              fetchNextPage,
              hasNextPage,
              isError: () => eventQueryState() === 'error',
              isFetching: () => false,
              isFetchingNextPage: () => false,
              isFetchNextPageError: nextPageError,
              isPending: () => false,
              isSuccess: () => eventQueryState() === 'success',
              refetch: refetchEvents,
            },
          },
        },
        {
          provide: PermissionsService,
          useValue: { hasPermissionSync: () => false },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('explains the discovery failure and recovers after retry', async () => {
    const fixture = TestBed.createComponent(EventListComponent);
    fixture.detectChanges();

    const alert: HTMLElement | null =
      fixture.nativeElement.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Events could not be loaded');
    expect(alert?.textContent).toContain(
      'Event discovery is temporarily unavailable.',
    );

    const retryButton: HTMLButtonElement | null =
      alert?.querySelector('button') ?? null;
    expect(retryButton?.textContent?.trim()).toBe('Try again');
    retryButton?.click();

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(normalizeText(fixture)).toContain('Recovery workshop');
    });
    expect(refetchEvents).toHaveBeenCalledOnce();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });

  it('has no filter control without a complete filtering product flow', () => {
    TestBed.overrideProvider(PermissionsService, {
      useValue: { hasPermissionSync: () => true },
    });
    eventQueryState.set('success');
    const fixture = TestBed.createComponent(EventListComponent);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('[aria-label="Filter events"]'),
    ).toBeNull();
  });

  it('loads another bounded page when more events may exist', () => {
    eventQueryState.set('success');
    hasNextPage.set(true);
    const fixture = TestBed.createComponent(EventListComponent);
    fixture.detectChanges();

    const loadMoreButton = [
      ...fixture.nativeElement.querySelectorAll('button'),
    ].find((button: HTMLButtonElement) =>
      button.textContent?.includes('Load more'),
    );
    expect(loadMoreButton).toBeDefined();
    loadMoreButton?.click();

    expect(fetchNextPage).toHaveBeenCalledOnce();
  });

  it('keeps loaded events visible and explains a later page failure', () => {
    eventQueryState.set('error');
    nextPageError.set(true);
    const fixture = TestBed.createComponent(EventListComponent);
    fixture.detectChanges();

    expect(normalizeText(fixture)).toContain('Recovery workshop');
    expect(normalizeText(fixture)).toContain(
      'More events could not be loaded. The events above are still available.',
    );
  });

  it('retains links and retries Load more after a real infinite-query page failure', async () => {
    const failures: unknown[] = [];
    let queryClient: QueryClient | undefined;
    let unsubscribe: (() => void) | undefined;
    let destroyObserver: (() => void) | undefined;
    let fixture: ComponentFixture<EventListComponent> | undefined;

    try {
      const day = listedEvents[0];
      const event = day?.events[0];
      if (!day || !event) throw new Error('Expected a listed event fixture.');
      const firstPage = [
        {
          day: day.day,
          events: Array.from({ length: EVENT_LIST_PAGE_SIZE }, (_, index) => ({
            ...event,
            id: `loaded-event-${index}`,
            title: index === 0 ? 'Recovery workshop' : `Loaded event ${index}`,
          })),
        },
      ];
      const secondPage = [
        {
          day: day.day,
          events: [
            { ...event, id: 'next-page-event', title: 'Next page workshop' },
          ],
        },
      ];
      let laterPageAttempts = 0;
      const readPage = vi.fn(async ({ pageParam }: { pageParam: number }) => {
        if (pageParam === 0) return firstPage;
        laterPageAttempts += 1;
        if (laterPageAttempts === 1) throw new Error('Later page unavailable');
        return secondPage;
      });
      const ownedClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      queryClient = ownedClient;
      const observer = new InfiniteQueryObserver(ownedClient, {
        getNextPageParam: eventListNextOffset,
        initialPageParam: 0,
        queryFn: readPage,
        queryKey: ['event-list-page-recovery'],
      });
      destroyObserver = () => observer.destroy();
      const result = signal(observer.getCurrentResult());
      unsubscribe = observer.subscribe((value) => result.set(value));
      TestBed.overrideProvider(EventListService, {
        useValue: {
          eventDays: () => mergeEventListPages(result().data?.pages ?? []),
          eventQuery: {
            error: () => result().error,
            fetchNextPage: () => observer.fetchNextPage(),
            hasNextPage: () => result().hasNextPage,
            isError: () => result().isError,
            isFetching: () => result().isFetching,
            isFetchingNextPage: () => result().isFetchingNextPage,
            isFetchNextPageError: () => result().isFetchNextPageError,
            isPending: () => result().isPending,
            isSuccess: () => result().isSuccess,
            refetch: () => observer.refetch(),
          },
        },
      });
      const rendered = TestBed.createComponent(EventListComponent);
      fixture = rendered;
      const root: unknown = rendered.nativeElement;
      if (!(root instanceof HTMLElement))
        throw new Error('Expected the actual event-list element.');
      const loadMoreButton = () =>
        [...root.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === 'Load more',
        );

      await vi.waitFor(() => {
        rendered.detectChanges();
        expect(result().isSuccess).toBe(true);
        expect(
          root.querySelector('a[href="/loaded-event-0"]')?.textContent,
        ).toContain('Recovery workshop');
        expect(loadMoreButton()?.disabled).toBe(false);
      });
      loadMoreButton()?.click();

      await vi.waitFor(() => {
        rendered.detectChanges();
        expect(result().isError).toBe(true);
        expect(result().isSuccess).toBe(false);
        expect(result().isFetchNextPageError).toBe(true);
        expect(
          root.querySelector('a[href="/loaded-event-0"]')?.textContent,
        ).toContain('Recovery workshop');
        expect(root.querySelector('[role="alert"]')?.textContent).toContain(
          'More events could not be loaded. The events above are still available.',
        );
        expect(root.textContent).not.toContain('Events could not be loaded');
        expect(loadMoreButton()?.disabled).toBe(false);
      });
      loadMoreButton()?.click();

      await vi.waitFor(() => {
        rendered.detectChanges();
        expect(result().isSuccess).toBe(true);
        expect(
          root.querySelector('a[href="/loaded-event-0"]')?.textContent,
        ).toContain('Recovery workshop');
        expect(
          root.querySelector('a[href="/next-page-event"]')?.textContent,
        ).toContain('Next page workshop');
        expect(root.querySelector('[role="alert"]')).toBeNull();
        expect(loadMoreButton()).toBeUndefined();
      });
      expect(readPage.mock.calls.map(([input]) => input.pageParam)).toEqual([
        0,
        EVENT_LIST_PAGE_SIZE,
        EVENT_LIST_PAGE_SIZE,
      ]);
    } catch (error) {
      failures.push(error);
    } finally {
      for (const cleanup of [
        () => fixture?.destroy(),
        () => unsubscribe?.(),
        () => destroyObserver?.(),
        () => queryClient?.cancelQueries(),
        () => queryClient?.clear(),
      ]) {
        try {
          await cleanup();
        } catch (error) {
          failures.push(error);
        }
      }
    }
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Event-list page recovery test or cleanup failed.',
      );
  });

  it('retains the existing registered and unlisted row markers without marking unrelated events', () => {
    eventQueryState.set('success');
    const fixture = TestBed.createComponent(EventListComponent);
    fixture.detectChanges();
    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new Error('Expected the event-list element.');
    const privateCard = root.querySelector<HTMLAnchorElement>(
      ':scope a[href="/event-private"]',
    );
    const registeredCard = root.querySelector<HTMLAnchorElement>(
      ':scope a[href="/event-registered"]',
    );
    const unrelatedCard = root.querySelector<HTMLAnchorElement>(
      ':scope a[href="/event-1"]',
    );
    expect(privateCard?.textContent).toContain('unlisted');
    expect(privateCard?.classList.contains('ring-success')).toBe(false);
    expect(registeredCard?.classList.contains('ring-success')).toBe(true);
    expect(registeredCard?.textContent).not.toContain('unlisted');
    expect(unrelatedCard?.classList.contains('ring-success')).toBe(false);
    expect(unrelatedCard?.textContent).not.toContain('unlisted');
  });
});

describe('event list paging', () => {
  const event = (
    id: string,
    start: string,
  ): EventsEventListDayRecord['events'][number] => ({
    icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
    id,
    start,
    status: 'APPROVED' as const,
    title: id,
    unlisted: false,
    userIsCreator: false,
    userRegistered: false,
  });

  it('requests the next offset only after a full page', () => {
    const fullPage = [
      {
        day: '2030-01-01T00:00:00.000Z',
        events: Array.from({ length: EVENT_LIST_PAGE_SIZE }, (_, index) =>
          event(`event-${index}`, '2030-01-01T12:00:00.000Z'),
        ),
      },
    ];

    expect(eventListNextOffset(fullPage, [fullPage])).toBe(
      EVENT_LIST_PAGE_SIZE,
    );
    const [fullDay] = fullPage;
    if (!fullDay) throw new Error('Expected a full event-list day');
    expect(
      eventListNextOffset(
        [{ ...fullDay, events: fullDay.events.slice(0, 99) }],
        [fullPage],
      ),
    ).toBeUndefined();
  });

  it('merges a tenant-local day split across page boundaries', () => {
    const pages = [
      [
        {
          day: '2030-01-01T00:00:00.000Z',
          events: [event('event-1', '2030-01-01T12:00:00.000Z')],
        },
      ],
      [
        {
          day: '2030-01-01T00:00:00.000Z',
          events: [event('event-2', '2030-01-01T13:00:00.000Z')],
        },
      ],
    ];

    expect(mergeEventListPages(pages)).toEqual([
      {
        day: '2030-01-01T00:00:00.000Z',
        events: [
          event('event-1', '2030-01-01T12:00:00.000Z'),
          event('event-2', '2030-01-01T13:00:00.000Z'),
        ],
      },
    ]);
  });
});
