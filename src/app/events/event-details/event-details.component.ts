import { Component, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  imports: [FontAwesomeModule, MatButtonModule, RouterLink, MatMenuModule],
  selector: 'app-event-details',
  styles: ``,
  templateUrl: './event-details.component.html',
})
export class EventDetailsComponent {
  protected readonly eventId = input.required<string>();
  private queries = inject(QueriesService);
  protected readonly eventQuery = injectQuery(this.queries.event(this.eventId));
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
}
