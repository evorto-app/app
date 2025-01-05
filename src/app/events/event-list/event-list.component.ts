import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faEllipsisVertical,
  faFilter,
} from '@fortawesome/duotone-regular-svg-icons';

@Component({
  imports: [FontAwesomeModule, MatButtonModule, MatMenuModule],
  selector: 'app-event-list',
  styles: ``,
  templateUrl: './event-list.component.html',
})
export class EventListComponent {
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faFilter = faFilter;
}
