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
import { getErrorMessage } from '../../core/error-message';

export interface EventRegistrationOptionView {
  appliedDiscountType?: 'esnCard' | null;
  closeRegistrationTime: string;
  confirmedSpots: number;
  description: null | string;
  discountApplied?: boolean;
  effectivePrice?: number;
  esnCardDiscountedPrice?: null | number;
  eventId: string;
  id: string;
  isPaid: boolean;
  openRegistrationTime: string;
  organizingRegistration: boolean;
  price: number;
  reservedSpots: number;
  spots: number;
  title: string;
}

export const registrationOptionAudienceCopy = (
  option: Pick<EventRegistrationOptionView, 'organizingRegistration'>,
): {
  actionSuffix: string;
  helperText: string;
  label: string;
  primaryAction: string;
} =>
  option.organizingRegistration
    ? {
        actionSuffix: 'sign up as organizer/helper',
        helperText: 'Use this option when you are helping run the event.',
        label: 'Organizer/helper option',
        primaryAction: 'Sign up as organizer/helper',
      }
    : {
        actionSuffix: 'register',
        helperText: 'Use this option when you are attending the event.',
        label: 'Participant option',
        primaryAction: 'Register',
      };

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, CurrencyPipe, DatePipe],
  selector: 'app-event-registration-option',
  styles: ``,
  templateUrl: './event-registration-option.component.html',
})
export class EventRegistrationOptionComponent {
  public readonly registrationOption =
    input.required<EventRegistrationOptionView>();
  protected readonly audienceCopy = computed(() =>
    registrationOptionAudienceCopy(this.registrationOption()),
  );
  private readonly rpc = AppRpc.injectClient();
  protected readonly authenticationQuery = injectQuery(() =>
    this.rpc.config.isAuthenticated.queryOptions(),
  );
  protected readonly full = computed(() => {
    const registrationOption = this.registrationOption();
    return (
      registrationOption.confirmedSpots + registrationOption.reservedSpots >=
      registrationOption.spots
    );
  });
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
    return getErrorMessage(error, 'Unknown error');
  }
}
