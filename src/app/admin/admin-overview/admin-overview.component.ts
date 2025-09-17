import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatBadgeModule } from '@angular/material/badge';
import { MatListModule } from '@angular/material/list';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faCalendarCheck,
  faFolderUser,
  faGlobe,
  faReceipt,
  faUsers,
  faUsersGear,
  faPercent,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { interval } from 'rxjs';

import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    FontAwesomeModule,
    MatListModule,
    MatBadgeModule,
  ],
  standalone: true,
  templateUrl: './admin-overview.component.html',
})
export class AdminOverviewComponent {
  protected readonly faCalendarCheck = faCalendarCheck;
  protected readonly faFolderUser = faFolderUser;
  protected readonly faGlobe = faGlobe;
  protected readonly faPercent = faPercent;
  protected readonly faReceipt = faReceipt;
  protected readonly faUsers = faUsers;
  protected readonly faUsersGear = faUsersGear;
  protected readonly outletActive = signal(false);
  private readonly trpc = injectTRPC();
  private readonly selfQuery = injectQuery(() =>
    this.trpc.users.self.queryOptions(),
  );
  private pendingReviewsFilter = computed(() => ({
    includeUnlisted: true,
    limit: 50,
    offset: 0,
    startAfter: new Date(),
    status: ['PENDING_REVIEW'] as const,
    userId: this.selfQuery.data()?.id,
  }));
  protected readonly pendingReviewsQuery = injectQuery(() =>
    this.trpc.events.findMany.queryOptions(this.pendingReviewsFilter()),
  );
  protected readonly pendingReviewsCount = computed(
    () => this.pendingReviewsQuery.data()?.length ?? 0,
  );

  constructor() {
    // Auto-refresh pending reviews count every minute
    interval(60_000)
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.pendingReviewsQuery.refetch();
      });
  }
}
