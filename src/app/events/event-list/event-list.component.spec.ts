import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../core/config.service';
import { PermissionsService } from '../../core/permissions.service';
import { EventListService } from '../event-list.service';
import { EventListComponent } from './event-list.component';

const eventQueryState = signal<'error' | 'success'>('error');
const listedEvents = [
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
            canSeeDrafts: signal(false),
            canSeeUnlisted: signal(false),
            eventQuery: {
              data: () => listedEvents,
              error: () => new Error('Events unavailable'),
              isError: () => eventQueryState() === 'error',
              isFetching: () => false,
              isPending: () => false,
              isSuccess: () => eventQueryState() === 'success',
              refetch: refetchEvents,
            },
            startFilter: signal(new Date('2030-01-01T00:00:00.000Z')),
          },
        },
        {
          provide: MatDialog,
          useValue: { open: vi.fn() },
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
});
