import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faClock,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  eventDiscoveryDescription,
  eventDiscoveryLabel,
} from '@shared/event-discovery';

import { ConfigService } from '../../core/config.service';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
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
    TenantDatePipe,
    MatTooltipModule,
    IfAnyPermissionDirective,
  ],
  selector: 'app-event-list',
  styles: ``,
  templateUrl: './event-list.component.html',
})
export class EventListComponent {
  private readonly eventListService = inject(EventListService);

  protected readonly eventDays = this.eventListService.eventDays;
  protected readonly eventDiscoveryDescription = eventDiscoveryDescription;
  protected readonly eventDiscoveryLabel = eventDiscoveryLabel;
  protected readonly eventQuery = this.eventListService.eventQuery;
  protected readonly faClock = faClock;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly outletActive = signal(false);
  private readonly config = inject(ConfigService);

  constructor() {
    this.config.updateTitle('Events');
  }
}
