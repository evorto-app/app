import { computed, inject, Injectable, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder } from '@angular/forms';
import { injectQuery } from '@tanstack/angular-query-experimental';
import consola from 'consola/browser';

import { PermissionsService } from '../core/permissions.service';
import { injectTRPC } from '../core/trpc-client';

@Injectable({
  providedIn: 'root',
})
/* eslint-disable perfectionist/sort-classes */
export class EventListService {
  private readonly formBuilder = inject(NonNullableFormBuilder);
  private readonly permissions = inject(PermissionsService);
  private readonly trpc = injectTRPC();

  private readonly pageConfig = signal({ limit: 100, offset: 0 });

  private readonly selfQuery = injectQuery(() => this.trpc.users.maybeSelf.queryOptions());

  private readonly includeUnlisted = signal(false);

  readonly canSeeDrafts = this.permissions.hasPermission('events:seeDrafts');
  readonly canSeeUnlisted = this.permissions.hasPermission('events:seeUnlisted');

  readonly startFilter = signal(new Date());

  readonly statusFilterControl = this.formBuilder.control<
    ('APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED')[]
  >(['APPROVED', 'DRAFT', 'PENDING_REVIEW', 'REJECTED']);

  private readonly statusFilterValue = toSignal(this.statusFilterControl.valueChanges, {
    initialValue: this.statusFilterControl.value,
  });

  private readonly filterInput = computed(() => {
    const pageConfig = this.pageConfig();
    const self = this.selfQuery.data();
    const startAfter = this.startFilter();
    const status = this.canSeeDrafts() ? this.statusFilterValue() : (['APPROVED'] as const);
    const includeUnlisted = this.canSeeUnlisted();
    const userId = self?.id;
    consola.info({
      includeUnlisted,
      startAfter,
      status,
      userId,
      ...pageConfig,
    });
    return {
      includeUnlisted,
      startAfter,
      status,
      userId,
      ...pageConfig,
    };
  });

  readonly eventQuery = injectQuery(() =>
    this.trpc.events.eventList.queryOptions(this.filterInput()),
  );

  updatePageConfig(config: { limit: number; offset: number }) {
    this.pageConfig.set(config);
  }

  updateStartFilter(date: Date) {
    this.startFilter.set(date);
  }

  setIncludeUnlisted(value: boolean) {
    this.includeUnlisted.set(value);
  }
}
