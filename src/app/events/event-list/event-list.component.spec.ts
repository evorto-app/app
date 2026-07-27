import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { PermissionsService } from '../../core/permissions.service';
import {
  EVENT_LIST_PAGE_SIZE,
  eventListNextOffset,
  EventListService,
  mergeEventListPages,
} from '../event-list.service';
import { EventListComponent } from './event-list.component';

const eventQueryState = signal<'error' | 'success'>('error');
const hasNextPage = signal(false);
const listedEvents = [
  {
    day: '2029-12-31T00:00:00.000Z',
    events: [
      {
        announcementRoleCount: 0,
        hasRegistrationOptions: true,
        icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
        id: 'event-1',
        listingAudience: 'both' as const,
        start: '2029-12-31T22:00:00.000Z',
        status: 'APPROVED' as const,
        title: 'Recovery workshop',
        userIsCreator: false,
        userRegistered: false,
      },
    ],
  },
];
const refetchEvents = vi.fn(async () => {
  eventQueryState.set('success');
});
const fetchNextPage = vi.fn(() => Promise.resolve());

const normalizeText = (fixture: ComponentFixture<EventListComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('EventListComponent load recovery', () => {
  beforeEach(async () => {
    eventQueryState.set('error');
    hasNextPage.set(false);
    fetchNextPage.mockClear();
    refetchEvents.mockClear();

    await TestBed.configureTestingModule({
      imports: [EventListComponent],
      providers: [
        provideRouter([]),
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
              isFetchNextPageError: () => false,
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

  it('renders an ongoing event returned by discovery even when it started before the active filter', () => {
    eventQueryState.set('success');
    const fixture = TestBed.createComponent(EventListComponent);
    fixture.detectChanges();

    expect(
      listedEvents[0]?.events[0]?.start < new Date('2030-01-01').toISOString(),
    ).toBe(true);
    expect(normalizeText(fixture)).toContain('Recovery workshop');
    expect(normalizeText(fixture)).toContain('Participants and organizers');
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
});

describe('event list paging', () => {
  const event = (id: string, start: string) => ({
    announcementRoleCount: 0,
    hasRegistrationOptions: true,
    icon: { iconColor: 0xff_67_50_a4, iconName: 'calendar:fas' },
    id,
    listingAudience: 'both' as const,
    start,
    status: 'APPROVED' as const,
    title: id,
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
