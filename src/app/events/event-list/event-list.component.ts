import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  PendingTasks,
  signal,
} from '@angular/core';
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
} from '@fortawesome/duotone-regular-svg-icons';
import { firstValueFrom } from 'rxjs';

import { ConfigService } from '../../core/config.service';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
import { EventFilterDialogComponent } from '../event-filter-dialog/event-filter-dialog.component';
import { EventListService } from '../event-list.service';

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
    MatDialogModule,
    MatChipsModule,
    IfAnyPermissionDirective,
  ],
  selector: 'app-event-list',
  styles: ``,
  templateUrl: './event-list.component.html',
})
export class EventListComponent {
  private readonly eventListService = inject(EventListService);

  // Expose service properties for template access
  protected readonly canSeeDrafts = this.eventListService.canSeeDrafts;
  protected readonly canSeeUnlisted = this.eventListService.canSeeUnlisted;
  protected readonly eventQuery = this.eventListService.eventQuery;
  protected readonly eventErrorMessage = computed(() => {
    const error = this.eventQuery.error();
    if (!error) {
      return 'Failed to load events';
    }

    if (typeof error === 'string') {
      return error;
    }

    return error.message;
  });
  protected readonly faClock = faClock;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faEyeSlash = faEyeSlash;
  protected readonly faFilter = faFilter;
  protected readonly outletActive = signal(false);
  protected readonly startFilter = this.eventListService.startFilter;
  private readonly config = inject(ConfigService);
  private readonly dialog = inject(MatDialog);
  private readonly taskService = inject(PendingTasks);

  constructor() {
    this.config.updateTitle('Events');
    const eventsLoaded = this.taskService.add();
    effect(() => {
      const successs = this.eventQuery.isSuccess();
      if (successs) {
        eventsLoaded();
      }
    });
  }

  protected async openFilterPanel() {
    await firstValueFrom(
      this.dialog.open(EventFilterDialogComponent).afterClosed(),
    );
  }
}
