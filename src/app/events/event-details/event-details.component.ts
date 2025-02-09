import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { RouterLink } from '@angular/router';
import { FontAwesomeModule } from '@fortawesome/angular-fontawesome';
import {
  faArrowLeft,
  faEllipsisVertical,
} from '@fortawesome/duotone-regular-svg-icons';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';

import { QueriesService } from '../../core/queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
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
  protected readonly registrationMutation = injectMutation(
    this.queries.registerForEvent(),
  );
  protected readonly registrationStatusQuery = injectQuery(
    this.queries.eventRegistrationStatus(this.eventId),
  );

  getRegistrationStatus(optionId: string) {
    const registration = this.registrationStatusQuery
      .data()
      ?.registrations.find((reg) => reg.registrationOptionId === optionId);
    return registration?.status ?? null;
  }

  isRegisteredForOption(optionId: string) {
    return (
      this.registrationStatusQuery
        .data()
        ?.registrations.some(
          (reg) =>
            reg.registrationOptionId === optionId && reg.status === 'CONFIRMED',
        ) ?? false
    );
  }

  register(registrationOption: { eventId: string; id: string }) {
    this.registrationMutation.mutate({
      eventId: registrationOption.eventId,
      registrationOptionId: registrationOption.id,
    });
  }
}
