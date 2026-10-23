import type { EventsEventListRecord } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import { faClock } from '@fortawesome/duotone-regular-svg-icons';

import { ConfigService } from '../../core/config.service';
import { TenantDatePipe } from '../../core/tenant-date.pipe';
import { IconComponent } from '../../shared/components/icon/icon.component';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';
import { EventListService } from '../event-list.service';

export const eventListSignUpStateLabel = (
  state: EventsEventListRecord['userSignUpState'],
): null | string => {
  switch (state) {
    case 'approvalPending': {
      return 'Waiting for approval';
    }
    case 'confirmed': {
      return 'Place confirmed';
    }
    case null: {
      return null;
    }
    case 'organizerConfirmed': {
      return 'Organizer confirmed';
    }
    case 'paymentRequired': {
      return 'Finish payment';
    }
    case 'waitlisted': {
      return 'On waitlist';
    }
  }
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class:
      'block lg:h-[calc(100dvh-1.5rem)] lg:min-h-0 lg:min-w-0 lg:flex-none lg:overflow-hidden',
  },
  imports: [
    FontAwesomeModule,
    MatButtonModule,
    RouterLink,
    IconComponent,
    RouterOutlet,
    RouterLinkActive,
    TenantDatePipe,
    IfAnyPermissionDirective,
  ],
  selector: 'app-event-list',
  styles: ``,
  templateUrl: './event-list.component.html',
})
export class EventListComponent {
  private readonly eventListService = inject(EventListService);

  protected readonly eventDays = this.eventListService.eventDays;
  protected readonly eventListSignUpStateLabel = eventListSignUpStateLabel;
  protected readonly eventQuery = this.eventListService.eventQuery;
  protected readonly faClock = faClock;
  protected readonly outletActive = signal(false);
  private readonly config = inject(ConfigService);

  constructor() {
    this.config.updateTitle('Events');
  }
}
