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
    appliedDiscountType?: 'esnCard' | null;
    closeRegistrationTime: Date;
    description: null | string;
    discountApplied?: boolean;
    effectivePrice?: number;
    esnCardDiscountedPrice?: null | number;
    eventId: string;
    id: string;
    isPaid: boolean;
    openRegistrationTime: Date;
    price: number;
    title: string;
  }>();
  private readonly rpc = AppRpc.injectClient();
  protected readonly authenticationQuery = injectQuery(() =>
    this.rpc.config.isAuthenticated.queryOptions(),
  );
  private queryClient = inject(QueryClient);
  private trpc = injectTRPC();
  protected readonly registrationMutation = injectMutation(() =>
    this.trpc.events.registerForEvent.mutationOptions({
      onSuccess: async ({ userRegistration: { eventId } }) => {
        await this.queryClient.invalidateQueries({
          queryKey: this.rpc.events.getRegistrationStatus.queryKey({
            eventId,
          }),
        });
      },
    }),
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
