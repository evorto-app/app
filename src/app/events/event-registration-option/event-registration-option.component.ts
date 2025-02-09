import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButton, MatButtonModule } from '@angular/material/button';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';
import { DateTime } from 'luxon';
import { interval, map } from 'rxjs';

import { QueriesService } from '../../core/queries.service';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, CurrencyPipe, DatePipe],
  selector: 'app-event-registration-option',
  styles: ``,
  templateUrl: './event-registration-option.component.html',
})
export class EventRegistrationOptionComponent {
  public readonly registrationOption = input.required<{
    closeRegistrationTime: Date;
    description: null | string;
    eventId: string;
    id: string;
    isPaid: boolean;
    openRegistrationTime: Date;
    price: number;
    title: string;
  }>();
  private queries = inject(QueriesService);
  protected readonly authenticationQuery = injectQuery(
    this.queries.isAuthenticated(),
  );
  protected readonly registrationMutation = injectMutation(
    this.queries.registerForEvent(),
  );
  private currentTime = toSignal(interval(1000).pipe(map(() => new Date())), {
    initialValue: new Date(),
  });

  protected registrationOpen = computed(() => {
    const currentTime = this.currentTime();
    const registrationOption = this.registrationOption();
    if (registrationOption.openRegistrationTime > currentTime) {
      return 'tooEarly';
    }
    if (registrationOption.closeRegistrationTime < currentTime) {
      return 'tooLate';
    }
    return 'open';
  });

  register(registrationOption: { eventId: string; id: string }) {
    this.registrationMutation.mutate({
      eventId: registrationOption.eventId,
      registrationOptionId: registrationOption.id,
    });
  }
}
