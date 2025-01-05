import { Component, inject, input } from '@angular/core';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  imports: [],
  selector: 'app-event-details',
  styles: ``,
  templateUrl: './event-details.component.html',
})
export class EventDetailsComponent {
  protected readonly eventId = input.required<string>();
  private queries = inject(QueriesService);
  protected readonly eventQuery = injectQuery(this.queries.event(this.eventId));
}
