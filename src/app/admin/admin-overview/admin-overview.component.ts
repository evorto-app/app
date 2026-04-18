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
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { interval } from 'rxjs';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { PermissionsService } from '../../core/permissions.service';

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
  templateUrl: './admin-overview.component.html',
})
export class AdminOverviewComponent {
  private readonly permissions = inject(PermissionsService);
  protected readonly canReviewEvents =
    this.permissions.hasPermission('events:review');
  protected readonly faCalendarCheck = faCalendarCheck;
  protected readonly faFolderUser = faFolderUser;
  protected readonly faGlobe = faGlobe;
  protected readonly faReceipt = faReceipt;
  protected readonly faUsers = faUsers;
  protected readonly faUsersGear = faUsersGear;
  protected readonly outletActive = signal(false);
  private readonly rpc = AppRpc.injectClient();
  protected readonly pendingReviewsQuery = injectQuery(() =>
    this.rpc.events.getPendingReviews.queryOptions(),
  );
  protected readonly pendingReviewsCount = computed(() =>
    this.canReviewEvents() ? (this.pendingReviewsQuery.data()?.length ?? 0) : 0,
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
