import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import {
  provideTanStackQuery,
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { APP_RPC_CLIENT } from '../../core/effect-rpc-angular-client';
import { PermissionsService } from '../../core/permissions.service';
import { AdminOverviewComponent } from './admin-overview.component';

const canReviewEvents = signal(false);
const loadPendingReviews = vi.fn();

const normalizeText = (fixture: ComponentFixture<AdminOverviewComponent>) =>
  fixture.nativeElement.textContent.replaceAll(/\s+/g, ' ').trim();

describe('AdminOverviewComponent query boundaries', () => {
  let queryClient: QueryClient;

  beforeEach(async () => {
    canReviewEvents.set(false);
    loadPendingReviews.mockReset();
    queryClient = new QueryClient({
      defaultOptions: {
        queries: {
          gcTime: 0,
          retry: false,
        },
      },
    });

    await TestBed.configureTestingModule({
      imports: [AdminOverviewComponent],
      providers: [
        provideRouter([]),
        provideTanStackQuery(queryClient),
        {
          provide: APP_RPC_CLIENT,
          useValue: {
            events: {
              getPendingReviews: {
                queryOptions: () => ({
                  queryFn: loadPendingReviews,
                  queryKey: ['events', 'pending-reviews'],
                }),
              },
            },
          },
        },
        {
          provide: PermissionsService,
          useValue: {
            hasPermission: () => canReviewEvents.asReadonly(),
            hasPermissionSync: () => canReviewEvents(),
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

  it('does not request pending reviews without the review capability', async () => {
    loadPendingReviews.mockResolvedValue([]);

    const fixture = TestBed.createComponent(AdminOverviewComponent);
    await fixture.whenStable();

    expect(loadPendingReviews).not.toHaveBeenCalled();
    expect(normalizeText(fixture)).not.toContain('Event reviews');
  });

  it('renders an explicit count failure for authorized reviewers', async () => {
    canReviewEvents.set(true);
    loadPendingReviews.mockRejectedValue(new Error('Reviews unavailable'));

    const fixture = TestBed.createComponent(AdminOverviewComponent);

    await vi.waitFor(async () => {
      await fixture.whenStable();
      expect(loadPendingReviews).toHaveBeenCalledOnce();
      expect(normalizeText(fixture)).toContain(
        'Event reviews Count unavailable',
      );
    });

    const status: HTMLElement | null =
      fixture.nativeElement.querySelector('[role="status"]');
    expect(status?.textContent?.trim()).toBe('Count unavailable');
  });
});
