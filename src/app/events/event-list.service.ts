import type { EventsEventListDayRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { computed, inject, Injectable } from '@angular/core';
import { injectInfiniteQuery } from '@tanstack/angular-query-experimental';

import { AppRpc } from '../core/effect-rpc-angular-client';
import { PermissionsService } from '../core/permissions.service';

export const EVENT_LIST_PAGE_SIZE = 100;

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
/* eslint-disable perfectionist/sort-classes */
export class EventListService {
  private readonly permissions = inject(PermissionsService);
  private readonly rpc = AppRpc.injectClient();
  private readonly findEvents = this.rpc.events.eventList;

  private readonly canSeeDrafts =
    this.permissions.hasPermission('events:seeDrafts');
  private readonly startAfter = new Date().toISOString();

  private readonly filterInput = computed(() => {
    const status = this.canSeeDrafts()
      ? (['APPROVED', 'DRAFT', 'PENDING_REVIEW'] as const)
      : (['APPROVED'] as const);
    return {
      limit: EVENT_LIST_PAGE_SIZE,
      startAfter: this.startAfter,
      status,
    };
  });

  readonly eventQuery = injectInfiniteQuery(() => {
    const input = this.filterInput();
    return {
      getNextPageParam: (
        lastPage: readonly EventsEventListDayRecord[],
        pages: readonly (readonly EventsEventListDayRecord[])[],
      ) => eventListNextOffset(lastPage, pages),
      initialPageParam: 0,
      queryFn: ({ pageParam }: { readonly pageParam: number }) =>
        this.findEvents.call({ ...input, offset: pageParam }),
      queryKey: this.findEvents.queryKey({ ...input, offset: 0 }),
    };
  });

  readonly eventDays = computed(() =>
    mergeEventListPages(this.eventQuery.data()?.pages ?? []),
  );
}
