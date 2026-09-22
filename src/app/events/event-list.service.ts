import type { EventsEventListDayRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { isPlatformServer } from '@angular/common';
import {
  computed,
  DestroyRef,
  effect,
  inject,
  Injectable,
  PendingTasks,
  PLATFORM_ID,
  signal,
} from '@angular/core';
import { form } from '@angular/forms/signals';
import {
  injectInfiniteQuery,
  injectQuery,
} from '@tanstack/angular-query-experimental';

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
export class EventListService {
  private readonly permissions = inject(PermissionsService);
  private readonly rpc = AppRpc.injectClient();
  private readonly findEvents = this.rpc.events.eventList;

  private readonly selfQuery = injectQuery(() =>
    this.rpc.users.maybeSelf.queryOptions(),
  );

  readonly canSeeDrafts = this.permissions.hasPermission('events:seeDrafts');
  readonly canSeeUnlisted =
    this.permissions.hasPermission('events:seeUnlisted');

  readonly startFilter = signal(new Date());
  private readonly statusFilterModel = signal<{
    status: ('APPROVED' | 'DRAFT' | 'PENDING_REVIEW')[];
  }>({
    status: ['APPROVED', 'DRAFT', 'PENDING_REVIEW'],
  });
  readonly statusFilterForm = form(this.statusFilterModel);

  private readonly filterInput = computed(() => {
    const self = this.selfQuery.data();
    const startAfter = this.startFilter().toISOString();
    const status = this.canSeeDrafts()
      ? this.statusFilterForm().value().status
      : (['APPROVED'] as const);
    const includeUnlisted = this.canSeeUnlisted();
    const userId = self?.id;
    return {
      includeUnlisted,
      limit: EVENT_LIST_PAGE_SIZE,
      startAfter,
      status,
      userId,
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

  constructor() {
    if (!isPlatformServer(inject(PLATFORM_ID))) return;

    const pendingTasks = inject(PendingTasks);
    let complete: (() => void) | undefined = pendingTasks.add();
    inject(DestroyRef).onDestroy(() => complete?.());

    // HTTP completion can precede publication of the query result to Angular.
    effect(() => {
      if (this.eventQuery.isPending()) {
        complete ??= pendingTasks.add();
      } else {
        complete?.();
        complete = undefined;
      }
    });
  }

  updateStartFilter(date: Date) {
    this.startFilter.set(date);
  }
}
