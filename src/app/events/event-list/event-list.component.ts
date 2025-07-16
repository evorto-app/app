import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NonNullableFormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faClock,
  faEllipsisVertical,
  faEyeSlash,
  faFilter,
  faLock,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';
import { firstValueFrom } from 'rxjs';

import { ConfigService } from '../../core/config.service';
import { PermissionsService } from '../../core/permissions.service';
import { injectTRPC } from '../../core/trpc-client';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
import { EventFilterDialogComponent } from '../event-filter-dialog/event-filter-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    MatMenuModule,
    RouterLink,
    IconComponent,
    RouterOutlet,
    RouterLinkActive,
    DatePipe,
    MatButtonToggleModule,
    MatTooltipModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatChipsModule,
    IfAnyPermissionDirective,
  ],
  selector: 'app-event-list',
  styles: ``,
  templateUrl: './event-list.component.html',
})
export class EventListComponent {
  private permissions = inject(PermissionsService);
  protected readonly canSeeDrafts =
    this.permissions.hasPermission('events:seeDrafts');
  protected readonly canSeeHidden =
    this.permissions.hasPermission('events:seeHidden');
  protected readonly canSeePrivate =
    this.permissions.hasPermission('events:seePrivate');
  protected readonly startFilter = signal(new Date());
  private readonly pageConfig = signal({ limit: 100, offset: 0 });
  private readonly trpc = injectTRPC();
  private readonly selfQuery = injectQuery(() =>
    this.trpc.users.maybeSelf.queryOptions(),
  );
  private readonly formBuilder = inject(NonNullableFormBuilder);
  protected readonly statusFilterControl = this.formBuilder.control<
    ('APPROVED' | 'DRAFT' | 'PENDING_REVIEW' | 'REJECTED')[]
  >(['APPROVED', 'DRAFT', 'PENDING_REVIEW', 'REJECTED']);
  private readonly statusFilterValue = toSignal(
    this.statusFilterControl.valueChanges,
    { initialValue: this.statusFilterControl.value },
  );
  private readonly visibilityFilterValue = signal([
    'PUBLIC',
    'HIDDEN',
    'PRIVATE',
  ] as const);
  private readonly filterInput = computed(() => {
    const pageConfig = this.pageConfig();
    const self = this.selfQuery.data();
    const startAfter = this.startFilter();
    const status = this.canSeeDrafts()
      ? this.statusFilterValue()
      : (['APPROVED'] as const);
    const visibilityFilter = this.visibilityFilterValue();
    const canSeePrivate = this.canSeePrivate();
    const canSeeHidden = this.canSeeHidden();
    const visibility = visibilityFilter.filter((option) => {
      if (canSeePrivate) {
        return true;
      }
      if (option === 'PRIVATE') {
        return false;
      }
      if (canSeeHidden) {
        return true;
      }
      return option !== 'HIDDEN';
    });
    const userId = self?.id;
    return {
      startAfter,
      status,
      userId,
      visibility,
      ...pageConfig,
    };
  });
  protected readonly eventQuery = injectQuery(() =>
    this.trpc.events.eventList.queryOptions(this.filterInput()),
  );
  protected readonly faClock = faClock;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faEyeSlash = faEyeSlash;
  protected readonly faFilter = faFilter;
  protected readonly faLock = faLock;
  protected readonly outletActive = signal(false);
  private readonly config = inject(ConfigService);
  private readonly dialog = inject(MatDialog);

  constructor() {
    this.config.updateTitle('Events');
  }

  protected async openFilterPanel() {
    const filters = await firstValueFrom(
      this.dialog.open(EventFilterDialogComponent).afterClosed(),
    );
  }
}
