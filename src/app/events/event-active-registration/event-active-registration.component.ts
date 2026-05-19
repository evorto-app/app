import type { EventsRegistrationStatus } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { CurrencyPipe, NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';

export const registrationCancellationCopy = (registration: {
  paymentPending: boolean;
  status: EventsRegistrationStatus;
}): null | {
  buttonLabel: string;
  helperText: string;
} => {
  if (registration.status === 'PENDING') {
    return {
      buttonLabel: 'Cancel registration',
      helperText: registration.paymentPending
        ? 'This cancels the pending registration and releases the reserved spot. It does not complete a payment.'
        : 'This cancels the pending registration and releases the reserved spot.',
    };
  }

  if (registration.status === 'CONFIRMED') {
    return {
      buttonLabel: 'Cancel registration',
      helperText:
        'This cancels your confirmed registration and releases your spot. Paid-registration refunds are not automatic yet.',
    };
  }

  if (registration.status === 'WAITLIST') {
    return {
      buttonLabel: 'Leave waitlist',
      helperText:
        'This removes you from the waitlist and releases your waitlist spot.',
    };
  }

  return null;
};

export const registrationDeferredActionCopy = (registration: {
  status: EventsRegistrationStatus;
}): null | string => {
  if (registration.status === 'CONFIRMED') {
    return 'Transfer/resale is not implemented yet. Contact the organizers if someone else should take your spot.';
  }

  if (registration.status === 'PENDING') {
    return 'Transfer/resale is not available for pending registrations.';
  }

  if (registration.status === 'WAITLIST') {
    return 'Transfer/resale is not available for waitlist registrations.';
  }

  return null;
};

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, MatButtonModule, NgOptimizedImage],
  selector: 'app-event-active-registration',
  styles: ``,
  templateUrl: './event-active-registration.component.html',
})
export class EventActiveRegistrationComponent {
  public readonly registrations = input.required<
    readonly {
      appliedDiscountedPrice?: null | number | undefined;
      appliedDiscountType?: 'esnCard' | null | undefined;
      basePriceAtRegistration?: null | number | undefined;
      checkoutUrl?: null | string | undefined;
      discountAmount?: null | number | undefined;
      guestCount: number;
      id: string;
      paymentPending: boolean;
      registeredDescription?: null | string | undefined;
      registrationOptionTitle: string;
      status: EventsRegistrationStatus;
    }[]
  >();
  protected readonly cancellationCopy = registrationCancellationCopy;
  private readonly rpc = AppRpc.injectClient();
  protected readonly cancelRegistrationMutation = injectMutation(() =>
    this.rpc.events.cancelRegistration.mutationOptions(),
  );
  protected readonly deferredActionCopy = registrationDeferredActionCopy;

  private readonly queryClient = inject(QueryClient);

  cancelRegistration(registration: { id: string }) {
    this.cancelRegistrationMutation.mutate(
      {
        registrationId: registration.id,
      },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['events', 'getRegistrationStatus']),
          );
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['events', 'findOne']),
          );
        },
      },
    );
  }

  protected errorMessage(error: unknown): string {
    return getErrorMessage(error, 'Cancellation failed');
  }
}
