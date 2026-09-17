import type { Permission } from '@shared/permissions/permissions';
import type { EventsEventListDayRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import {
  ApplicationRef,
  createEnvironmentInjector,
  EnvironmentInjector,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatMenuHarness } from '@angular/material/menu/testing';
import { provideRouter } from '@angular/router';
import { createRpcQueryKey } from '@heddendorp/effect-angular-query';
import { provideTanStackQuery } from '@tanstack/angular-query-experimental';
import { InfiniteQueryObserver, QueryClient } from '@tanstack/query-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { APP_RPC_CLIENT, AppRpc } from '../../core/effect-rpc-angular-client';
import { PermissionsService } from '../../core/permissions.service';
import { TENANT_DATE_PIPE_TIMEZONE } from '../../core/tenant-date.pipe';
import {
  EVENT_LIST_PAGE_SIZE,
  eventListNextOffset,
  EventListService,
  mergeEventListPages,
} from '../event-list.service';
import {
  EventListComponent,
  eventListSignUpStateLabel,
} from './event-list.component';

const eventQueryState = signal<'error' | 'success'>('error');
const hasNextPage = signal(false);
const nextPageError = signal(false);
const fetchNextPage = vi.fn(() => Promise.resolve());
const listedEvents: readonly EventsEventListDayRecord[] = [
  {
    day: '2030-01-02T00:00:00.000Z',
    events: [
      {
        announcementRoleCount: 0,
        hasRegistrationOptions: true,
        icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
        id: 'event-1',
        start: '2030-01-02T10:00:00.000Z',
        status: 'APPROVED' as const,
        title: 'Recovery workshop',
        userSignUpState: null,
      },
      {
        announcementRoleCount: 0,
        hasRegistrationOptions: true,
        icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
        id: 'event-confirmed',
        start: '2030-01-02T10:30:00.000Z',
        status: 'APPROVED' as const,
        title: 'Confirmed event',
        userSignUpState: 'confirmed' as const,
      },
      {
        announcementRoleCount: 0,
        hasRegistrationOptions: true,
        icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
        id: 'event-approval',
        start: '2030-01-02T11:00:00.000Z',
        status: 'APPROVED' as const,
        title: 'Application event',
        userSignUpState: 'approvalPending' as const,
      },
      {
        announcementRoleCount: 0,
        hasRegistrationOptions: true,
        icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
        id: 'event-payment',
        start: '2030-01-02T11:30:00.000Z',
        status: 'APPROVED' as const,
        title: 'Paid event',
        userSignUpState: 'paymentRequired' as const,
      },
      {
        announcementRoleCount: 0,
        hasRegistrationOptions: true,
        icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
        id: 'event-waitlist',
        start: '2030-01-02T12:00:00.000Z',
        status: 'APPROVED' as const,
        title: 'Waitlist event',
        userSignUpState: 'waitlisted' as const,
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
      'No events are shown. Select Try again.',
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

  const renderWithPermissions = (initialPermissions: Permission[]) => {
    const permissions = signal(initialPermissions);
    TestBed.overrideProvider(ConfigService, {
      useValue: {
        get permissions() {
          return permissions();
        },
        updateTitle: vi.fn(),
      },
    });
    TestBed.overrideProvider(PermissionsService, {
      useFactory: () => new PermissionsService(),
    });
    eventQueryState.set('success');
    const fixture = TestBed.createComponent(EventListComponent);
    fixture.detectChanges();
    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new Error('Expected the rendered event list.');
    return { fixture, permissions, root };
  };

  it.each([
    { label: 'anonymous', permissions: [] },
    { label: 'member', permissions: ['internal:viewInternalPages'] },
    { label: 'reviewer', permissions: ['events:review'] },
  ] satisfies { label: string; permissions: Permission[] }[])(
    'keeps public event links without an empty actions menu for $label',
    ({ permissions }) => {
      const { root } = renderWithPermissions(permissions);

      expect(root.querySelector('a[href="/event-1"]')?.textContent).toContain(
        'Recovery workshop',
      );
      expect(
        root.querySelector('[aria-label="Open event list actions"]'),
      ).toBeNull();
      expect(root.querySelector('a[href="/templates"]')).toBeNull();
    },
  );

  it.each(['events:create', 'events:*'] satisfies Permission[])(
    'keeps the working creation menu for %s and removes it when access is revoked',
    async (permission) => {
      const { fixture, permissions, root } = renderWithPermissions([
        permission,
      ]);
      const menu = await TestbedHarnessEnvironment.loader(fixture).getHarness(
        MatMenuHarness.with({
          selector: '[aria-label="Open event list actions"]',
        }),
      );
      await menu.open();
      const items = await menu.getItems();
      expect(items).toHaveLength(1);
      const [createEvent] = items;
      if (!createEvent) throw new Error('Expected the create event action.');
      expect(await createEvent.getText()).toBe('Create Event');
      const createEventLink = await createEvent.host();
      expect(await createEventLink.getAttribute('href')).toBe('/templates');
      await menu.close();
      permissions.set([]);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(
        root.querySelector('[aria-label="Open event list actions"]'),
      ).toBeNull();
      expect(root.querySelector('a[href="/event-1"]')?.textContent).toContain(
        'Recovery workshop',
      );
    },
  );

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

  it('shows current sign-up states and marks only related events', () => {
    eventQueryState.set('success');
    const fixture = TestBed.createComponent(EventListComponent);
    fixture.detectChanges();
    const root: unknown = fixture.nativeElement;
    if (!(root instanceof HTMLElement)) {
      throw new TypeError('Expected the rendered event list element.');
    }
    const cards = [...root.querySelectorAll('a')];
    const card = (title: string) =>
      cards.find((candidate) => candidate.textContent?.includes(title));

    expect(card('Confirmed event')?.textContent).toContain('Place confirmed');
    expect(card('Application event')?.textContent).toContain(
      'Waiting for approval',
    );
    expect(card('Paid event')?.textContent).toContain('Finish payment');
    expect(card('Waitlist event')?.textContent).toContain('On waitlist');
    for (const title of [
      'Confirmed event',
      'Application event',
      'Paid event',
      'Waitlist event',
    ]) {
      expect(card(title)?.classList.contains('ring-primary')).toBe(true);
      expect(card(title)?.textContent).not.toContain('unlisted');
    }
    expect(card('Recovery workshop')?.classList.contains('ring-primary')).toBe(
      false,
    );
    expect(card('Recovery workshop')?.textContent).not.toMatch(
      /Place confirmed|Waiting for approval|Finish payment|On waitlist|unlisted/u,
    );
  });
});

type EventListRpc = ReturnType<
  typeof AppRpc.injectClient
>['events']['eventList'];

const readinessEventListKey: EventListRpc['queryKey'] = (input) =>
  createRpcQueryKey(['events', 'eventList'], {
    input,
    keyPrefix: 'rpc',
    type: 'query',
  });

const pendingEventListRead = () => {
  let resolveRead:
    ((events: readonly EventsEventListDayRecord[]) => void) | undefined;
  let rejectRead: ((error: Error) => void) | undefined;
  // Angular's browser library target does not expose Promise.withResolvers.
  // eslint-disable-next-line unicorn/prefer-promise-with-resolvers
  const promise = new Promise<readonly EventsEventListDayRecord[]>(
    (resolve, reject) => {
      resolveRead = resolve;
      rejectRead = reject;
    },
  );
  if (!resolveRead || !rejectRead)
    throw new Error('Expected a controlled event-list read.');
  return { promise, reject: rejectRead, resolve: resolveRead };
};

describe('EventListComponent server rendering readiness', () => {
  const startAfter = '2030-01-01T00:00:00.000Z';
  const canSeeDrafts = signal(false);
  let childInjector: EnvironmentInjector | undefined;
  let fixture: ComponentFixture<EventListComponent> | undefined;
  let queryClient: QueryClient;
  let read: ReturnType<typeof pendingEventListRead>;
  let loadEvents: ReturnType<typeof vi.fn<EventListRpc['call']>>;

  beforeEach(async () => {
    // Only freeze Date; keep the real query and Angular notification timers.
    vi.setSystemTime(new Date(startAfter));
    canSeeDrafts.set(false);
    read = pendingEventListRead();
    loadEvents = vi.fn<EventListRpc['call']>(() => read.promise);
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { gcTime: 0, retry: false, staleTime: Infinity },
      },
    });
    await TestBed.configureTestingModule({
      imports: [EventListComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        { provide: PLATFORM_ID, useValue: 'server' },
        { provide: TENANT_DATE_PIPE_TIMEZONE, useValue: 'Europe/Berlin' },
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            events: {
              eventList: { call: loadEvents, queryKey: readinessEventListKey },
            },
          },
        },
        { provide: ConfigService, useValue: { updateTitle: vi.fn() } },
        {
          provide: PermissionsService,
          useValue: {
            hasPermission: (permission: Permission) =>
              permission === 'events:seeDrafts' ? canSeeDrafts : signal(false),
            hasPermissionSync: () => false,
          },
        },
      ],
    }).compileComponents();
  });

  afterEach(async () => {
    const failures: unknown[] = [];
    for (const cleanup of [
      () => childInjector?.destroy(),
      () => fixture?.destroy(),
      () => queryClient.cancelQueries(),
      () => read.resolve([]),
      () => queryClient.clear(),
      () => TestBed.resetTestingModule(),
      () => vi.useRealTimers(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error);
      }
    }
    childInjector = undefined;
    fixture = undefined;
    if (failures.length > 0)
      throw new AggregateError(
        failures,
        'Event-list readiness cleanup failed.',
      );
  });

  const renderEventList = () => {
    const rendered = TestBed.createComponent(EventListComponent);
    fixture = rendered;
    const root: unknown = rendered.nativeElement;
    if (!(root instanceof HTMLElement))
      throw new Error('Expected the actual event-list element.');
    rendered.detectChanges();
    return {
      fixture: rendered,
      root,
      service: TestBed.inject(EventListService),
    };
  };

  const cacheFirstPage = () => {
    queryClient.setQueryData(
      readinessEventListKey({
        limit: EVENT_LIST_PAGE_SIZE,
        offset: 0,
        startAfter,
        status: ['APPROVED'],
      }),
      { pageParams: [0], pages: [listedEvents] },
    );
  };

  it('renders event links at the first stable point after a server read succeeds', async () => {
    const { fixture: rendered, root, service } = renderEventList();
    expect(root.textContent).toContain('Loading events');
    expect(loadEvents).toHaveBeenCalledOnce();
    const firstStable = rendered.whenStable().then(() => ({
      link: root.querySelector('a[href="/event-1"]')?.textContent,
      pending: service.eventQuery.isPending(),
      text: root.textContent,
    }));

    read.resolve(listedEvents);
    const snapshot = await firstStable;

    expect(snapshot.pending).toBe(false);
    expect(snapshot.link).toContain('Recovery workshop');
    expect(snapshot.text).not.toContain('Loading events');
  });

  it('renders an explicit failure at the first stable point after a server read fails', async () => {
    const { fixture: rendered, root, service } = renderEventList();
    const firstStable = rendered.whenStable().then(() => ({
      alert: root.querySelector('[role="alert"]')?.textContent,
      pending: service.eventQuery.isPending(),
      text: root.textContent,
    }));

    read.reject(new Error('Events unavailable'));
    const snapshot = await firstStable;

    expect(snapshot.pending).toBe(false);
    expect(snapshot.alert).toContain('Events could not be loaded');
    expect(snapshot.alert).toContain('Try again');
    expect(snapshot.text).not.toContain('Loading events');
    expect(loadEvents).toHaveBeenCalledOnce();
  });

  it('renders cached server results without waiting for another request', async () => {
    cacheFirstPage();
    const { fixture: rendered, root, service } = renderEventList();

    await rendered.whenStable();

    expect(service.eventQuery.isPending()).toBe(false);
    expect(root.querySelector('a[href="/event-1"]')?.textContent).toContain(
      'Recovery workshop',
    );
    expect(root.textContent).not.toContain('Loading events');
    expect(loadEvents).not.toHaveBeenCalled();
  });

  it('waits for the changed server permissions query after a cached result was ready', async () => {
    cacheFirstPage();
    const { fixture: rendered, root, service } = renderEventList();
    await rendered.whenStable();
    canSeeDrafts.set(true);
    rendered.detectChanges();
    expect(service.eventQuery.isPending()).toBe(true);
    expect(loadEvents).toHaveBeenCalledOnce();
    expect(loadEvents).toHaveBeenLastCalledWith({
      limit: EVENT_LIST_PAGE_SIZE,
      offset: 0,
      startAfter,
      status: ['APPROVED', 'DRAFT', 'PENDING_REVIEW'],
    });
    const firstStable = rendered.whenStable().then(() => ({
      link: root.querySelector('a[href="/event-1"]')?.textContent,
      pending: service.eventQuery.isPending(),
      text: root.textContent,
    }));

    read.resolve(listedEvents);
    const snapshot = await firstStable;

    expect(snapshot.pending).toBe(false);
    expect(snapshot.link).toContain('Recovery workshop');
    expect(snapshot.text).not.toContain('Loading events');
  });

  it('keeps browser loading interactive while the first request is unresolved', async () => {
    TestBed.overrideProvider(PLATFORM_ID, { useValue: 'browser' });
    const { fixture: rendered, root, service } = renderEventList();

    await rendered.whenStable();

    expect(service.eventQuery.isPending()).toBe(true);
    expect(root.textContent).toContain('Loading events');
    read.resolve(listedEvents);
    await vi.waitFor(() => {
      rendered.detectChanges();
      expect(root.querySelector('a[href="/event-1"]')?.textContent).toContain(
        'Recovery workshop',
      );
    });
  });

  it('releases application readiness when its injector is destroyed with an unresolved read', async () => {
    const application = TestBed.inject(ApplicationRef);
    const ownedInjector = createEnvironmentInjector(
      [EventListService],
      TestBed.inject(EnvironmentInjector),
    );
    childInjector = ownedInjector;
    let stable = true;
    const subscription = application.isStable.subscribe((value) => {
      stable = value;
    });
    try {
      const service = ownedInjector.get(EventListService);
      TestBed.tick();
      expect(loadEvents).toHaveBeenCalledOnce();
      expect(service.eventQuery.isPending()).toBe(true);
      expect(stable).toBe(false);
      const firstStable = application.whenStable();

      ownedInjector.destroy();
      childInjector = undefined;
      await firstStable;

      expect(stable).toBe(true);
      expect(service.eventQuery.isPending()).toBe(true);
    } finally {
      subscription.unsubscribe();
    }
  });
});

describe('event list paging', () => {
  const event = (
    id: string,
    start: string,
  ): EventsEventListDayRecord['events'][number] => ({
    announcementRoleCount: 0,
    hasRegistrationOptions: true,
    icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
    id,
    start,
    status: 'APPROVED' as const,
    title: id,
    userSignUpState: null,
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

describe('eventListSignUpStateLabel', () => {
  it('maps each server state to concise participant copy', () => {
    expect(eventListSignUpStateLabel('confirmed')).toBe('Place confirmed');
    expect(eventListSignUpStateLabel('approvalPending')).toBe(
      'Waiting for approval',
    );
    expect(eventListSignUpStateLabel('paymentRequired')).toBe('Finish payment');
    expect(eventListSignUpStateLabel('waitlisted')).toBe('On waitlist');
    expect(eventListSignUpStateLabel(null)).toBeNull();
  });
});
