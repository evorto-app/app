import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faEllipsisVertical,
  faFilter,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';
import { IconComponent } from '../../shared/components/icon/icon.component';

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
  ],
  selector: 'app-event-list',
  styles: ``,
  templateUrl: './event-list.component.html',
})
export class EventListComponent {
  private readonly queries = inject(QueriesService);
  protected readonly eventQuery = injectQuery(this.queries.events());
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faFilter = faFilter;
  protected readonly outletActive = signal(false);
}
