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
  QueryClient,
} from '@tanstack/angular-query-experimental';
import { interval, map } from 'rxjs';

import { AppRpc } from '../../core/effect-rpc-angular-client';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, CurrencyPipe, DatePipe],
  selector: 'app-event-registration-option',
  styles: ``,
  templateUrl: './event-registration-option.component.html',
})
export class EventRegistrationOptionComponent {
  public readonly registrationOption = input.required<{
    appliedDiscountType?: 'esnCard' | null;
    closeRegistrationTime: string;
    description: null | string;
    discountApplied?: boolean;
    effectivePrice?: number;
    esnCardDiscountedPrice?: null | number;
    eventId: string;
    id: string;
    isPaid: boolean;
    openRegistrationTime: string;
    price: number;
    title: string;
  }>();
  private readonly rpc = AppRpc.injectClient();
  protected readonly authenticationQuery = injectQuery(() =>
    this.rpc.config.isAuthenticated.queryOptions(),
  );
  protected readonly registrationMutation = injectMutation(() =>
    this.rpc.events.registerForEvent.mutationOptions(),
  );
  private currentTime = toSignal(interval(1000).pipe(map(() => new Date())), {
    initialValue: new Date(),
  });
  protected registrationOpen = computed(() => {
    const currentTime = this.currentTime();
    const registrationOption = this.registrationOption();
    if (new Date(registrationOption.openRegistrationTime) > currentTime) {
      return 'tooEarly';
    }
    if (new Date(registrationOption.closeRegistrationTime) < currentTime) {
      return 'tooLate';
    }
    return 'open';
  });

  private queryClient = inject(QueryClient);

  register(registrationOption: { eventId: string; id: string }) {
    this.registrationMutation.mutate(
      {
        eventId: registrationOption.eventId,
        registrationOptionId: registrationOption.id,
      },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries({
            queryKey: this.rpc.events.getRegistrationStatus.queryKey({
              eventId: registrationOption.eventId,
            }),
          });
        },
      },
    );
  }

  protected errorMessage(error: unknown): string {
    if (typeof error === 'string') {
      return error;
    }
    if (error && typeof error === 'object') {
      const message = Reflect.get(error, 'message');
      if (typeof message === 'string') {
        return message;
      }
    }
    return 'Unknown error';
  }
}
