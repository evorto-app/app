import type { EventsEventListDayRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { computed, inject, Injectable } from '@angular/core';
import { MAX_PAGE_LIMIT } from '@shared/schema-utilities';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../core/effect-rpc-angular-client';
import { PermissionsService } from '../core/permissions.service';
import { holdServerRenderWhile } from '../core/server-render-pending';

export const EVENT_LIST_PAGE_SIZE = MAX_PAGE_LIMIT;

const eventListPageEventCount = (
  page: readonly EventsEventListDayRecord[],
): number => page.reduce((total, day) => total + day.events.length, 0);

export const eventListNextOffset = (
  lastPage: readonly EventsEventListDayRecord[],
  pages: readonly (readonly EventsEventListDayRecord[])[],
): number | undefined =>
  eventListPageEventCount(lastPage) === EVENT_LIST_PAGE_SIZE
    ? pages.reduce((total, page) => total + eventListPageEventCount(page), 0)
    : undefined;

export const mergeEventListPages = (
  pages: readonly (readonly EventsEventListDayRecord[])[],
): EventsEventListDayRecord[] => {
  const mergedDays: EventsEventListDayRecord[] = [];

  for (const page of pages) {
    for (const day of page) {
      const previousDay = mergedDays.at(-1);
      if (previousDay?.day === day.day) {
        mergedDays[mergedDays.length - 1] = {
          day: previousDay.day,
          events: [...previousDay.events, ...day.events],
        };
      } else {
        mergedDays.push({ day: day.day, events: [...day.events] });
      }
    }
  }

  return mergedDays;
};

@Injectable({
  providedIn: 'root',
})
export class EventListService {
  private readonly permissions = inject(PermissionsService);
  private readonly rpc = AppRpc.injectClient();
  private readonly findEvents = this.rpc.events.eventList;

  private readonly canSeeDrafts =
    this.permissions.hasPermission('events:seeDrafts');
  private readonly startAfter = new Date().toISOString();

  private readonly filterInput = {
    limit: EVENT_LIST_PAGE_SIZE,
    startAfter: this.startAfter,
    // The server scopes unpublished rows to the creator or authorized viewers.
    status: ['APPROVED', 'DRAFT', 'PENDING_REVIEW'] as const,
  };

  readonly eventQuery = injectInfiniteQuery(() => {
    const input = this.filterInput;
    return {
      getNextPageParam: (
        lastPage: readonly EventsEventListDayRecord[],
        pages: readonly (readonly EventsEventListDayRecord[])[],
      ) => eventListNextOffset(lastPage, pages),
      initialPageParam: 0,
      queryFn: ({ pageParam }: { readonly pageParam: number }) =>
        this.findEvents.call({ ...input, offset: pageParam }),
      queryKey: [
        ...this.findEvents.queryKey({ ...input, offset: 0 }),
        { canSeeDrafts: this.canSeeDrafts() },
      ],
    };
  });

  readonly eventDays = computed(() =>
    mergeEventListPages(this.eventQuery.data()?.pages ?? []),
  );

  constructor() {
    holdServerRenderWhile(() => this.eventQuery.isPending());
  }
}
