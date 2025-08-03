import { DatePipe, PercentPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import { faArrowLeft } from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { ConfigService } from '../../core/config.service';
import { injectTRPC } from '../../core/trpc-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    FaDuotoneIconComponent,
    MatButtonModule,
    PercentPipe,
    RouterLink,
  ],
  selector: 'app-event-organize',
  templateUrl: './event-organize.html',
})
export class EventOrganize {
  eventId = input.required<string>();

  private trpc = injectTRPC();
  // Event data (reuse existing queries)
  protected readonly eventQuery = injectQuery(() =>
    this.trpc.events.findOne.queryOptions({ id: this.eventId() }),
  );

  event = computed(() => this.eventQuery.data());

  // Basic stats computation
  stats = computed(() => {
    const eventData = this.event();
    const registrationOptions = eventData?.registrationOptions || [];
    const totalCapacity = registrationOptions.reduce(
      (sum, option) => sum + option.spots,
      0,
    );
    const totalRegistered = registrationOptions.reduce(
      (sum, option) => sum + option.confirmedSpots,
      0,
    );
    const totalCheckedIn = registrationOptions.reduce(
      (sum, option) => sum + option.checkedInSpots,
      0,
    );

    return {
      capacity: totalCapacity,
      capacityPercentage:
        totalCapacity > 0 ? totalRegistered / totalCapacity : 0,
      checkedIn: totalCheckedIn,
      registered: totalRegistered,
    };
  });

  protected readonly faArrowLeft = faArrowLeft;

  private config = inject(ConfigService);

  constructor() {
    // Update page title when event loads
    effect(() => {
      const event = this.event();
      if (event) {
        console.log(event);
        this.config.updateTitle(`Organize ${event.title}`);
      }
    });
  }

}
