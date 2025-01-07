import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faEllipsisVertical,
  faFilter,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  imports: [FontAwesomeModule, MatButtonModule, MatMenuModule, RouterLink],
  selector: 'app-event-list',
  styles: ``,
  templateUrl: './event-list.component.html',
})
export class EventListComponent {
  private readonly queries = inject(QueriesService);
  protected readonly eventQuery = injectQuery(this.queries.events());
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faFilter = faFilter;
}
