import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatMenu, MatMenuItem, MatMenuModule } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { FaDuotoneIconComponent } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
  faQrcode,
} from '@fortawesome/duotone-regular-svg-icons';
import { injectQuery } from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';
import { IfAnyPermissionDirective } from '../../shared/directives/if-any-permission.directive';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FaDuotoneIconComponent,
    IfAnyPermissionDirective,
    MatIconButton,
    MatMenuModule,
    RouterLink,
  ],
  selector: 'app-event-organize',
  styles: ``,
  templateUrl: './event-organize.html',
})
export class EventOrganize {
  public eventId = input.required<string>();
  private queries = inject(QueriesService);
  private router = inject(Router);
  
  protected readonly eventQuery = injectQuery(this.queries.event(this.eventId));
  protected readonly participantsQuery = injectQuery(this.queries.eventParticipants(this.eventId));
  
  protected readonly faArrowLeft = faArrowLeft;
  protected readonly faEllipsisVertical = faEllipsisVertical;
  protected readonly faQrcode = faQrcode;

  openScanner() {
    this.router.navigate(['/scan'], { 
      queryParams: { eventId: this.eventId() } 
    });
  }
}
