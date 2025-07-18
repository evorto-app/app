import { CurrencyPipe, DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import {
  injectMutation,
  injectQuery,
} from '@tanstack/angular-query-experimental';
import { interval, map } from 'rxjs';

import { injectTRPC } from '../../core/trpc-client';

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
  private trpc = injectTRPC();
  protected readonly authenticationQuery = injectQuery(() =>
    this.trpc.config.isAuthenticated.queryOptions(),
  );
  protected readonly registrationMutation = injectMutation(() =>
    this.trpc.events.registerForEvent.mutationOptions(),
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
