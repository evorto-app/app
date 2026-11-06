import type { EventsEventListRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { computed, inject, Injectable } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { DateTime } from 'luxon';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { holdServerRenderWhile } from '../../core/server-render-pending';
import { EventListService } from '../event-list.service';

const previewCount = 8;

export const distinctEventPreviews = (
  upcoming: readonly EventsEventListRecord[],
  recent: readonly EventsEventListRecord[],
) => {
  const byIcon = new Map<string, EventsEventListRecord>();
  for (const event of [...upcoming.slice(0, previewCount), ...recent]) {
    if (!byIcon.has(event.icon.iconName))
      byIcon.set(event.icon.iconName, event);
    if (byIcon.size === previewCount) break;
  }
  return [...byIcon.values()];
};

export const eventPreviewRelativeDate = (
  start: string,
  now: string,
  timezone: string,
) => {
  const date = DateTime.fromISO(start, { zone: timezone });
  const base = DateTime.fromISO(now, { zone: timezone });
  const days = Math.abs(date.diff(base, 'days').days);
  return date.toRelativeCalendar({
    base,
    locale: 'en',
    unit:
      days < 7 ? 'days' : days < 28 ? 'weeks' : days < 365 ? 'months' : 'years',
  });
};

@Injectable({ providedIn: 'root' })
export class EventPreviewService {
  private readonly list = inject(EventListService);
  private readonly rpc = AppRpc.injectClient();
  private readonly cutoff = new Date().toISOString();
  private readonly upcoming = computed(() =>
    this.list.eventDays().flatMap((day) => day.events),
  );
  private readonly needsRecent = computed(
    () =>
      this.list.eventQuery.isSuccess() &&
      distinctEventPreviews(this.upcoming(), []).length < previewCount,
  );
  private readonly recentQuery = injectQuery(() => ({
    ...this.rpc.events.eventList.queryOptions({
      endedBefore: this.cutoff,
      limit: previewCount,
      offset: 0,
      startAfter: '1970-01-01T00:00:00.000Z',
      status: ['APPROVED'],
    }),
    enabled: this.needsRecent(),
  }));

  readonly events = computed(() =>
    distinctEventPreviews(
      this.upcoming(),
      this.recentQuery.data()?.flatMap((day) => day.events) ?? [],
    ),
  );

  readonly failed = computed(() => this.recentQuery.isError());
  readonly retry = () => this.recentQuery.refetch();

  constructor() {
    holdServerRenderWhile(
      () => this.needsRecent() && this.recentQuery.isPending(),
    );
  }
}
