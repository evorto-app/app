import type { EventsRegistrationStatus } from '@shared/rpc-contracts/app-rpcs/events.rpcs';

import { CurrencyPipe, DatePipe, NgOptimizedImage } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import {
  injectMutation,
  QueryClient,
} from '@tanstack/angular-query-experimental';

import { AppRpc } from '../../core/effect-rpc-angular-client';
import { getErrorMessage } from '../../core/error-message';
import {
  EventRegistrationTransferDialogComponent,
  type EventRegistrationTransferDialogData,
} from './event-registration-transfer-dialog.component';

export const recipientTransferCheckoutPending = (registration: {
  activeTransfer: null | {
    registrationSide: 'recipient' | 'source';
    status: 'checkout_pending' | 'open';
  };
  status: EventsRegistrationStatus;
}): boolean =>
  registration.status === 'PENDING' &&
  registration.activeTransfer?.registrationSide === 'recipient' &&
  registration.activeTransfer.status === 'checkout_pending';

export const registrationCancellationCopy = (registration: {
  activeTransfer: null | {
    registrationSide: 'recipient' | 'source';
    status: 'checkout_pending' | 'open';
  };
  guestCount: number;
  paymentPending: boolean;
  status: EventsRegistrationStatus;
}): null | {
  buttonLabel: string;
  helperText: string;
} => {
  const pendingSpotNoun =
    registration.guestCount > 0 ? 'all selected spots' : 'the reserved spot';
  const confirmedSpotNoun =
    registration.guestCount > 0 ? 'all selected spots' : 'your spot';

  if (recipientTransferCheckoutPending(registration)) {
    return null;
  }

  if (registration.status === 'PENDING') {
    return {
      buttonLabel: 'Cancel registration',
      helperText: registration.paymentPending
        ? `This cancels the pending registration and releases ${pendingSpotNoun}. It does not complete a payment.`
        : 'This withdraws your pending application before organizer approval.',
    };
  }

  if (registration.status === 'CONFIRMED') {
    return {
      buttonLabel: 'Cancel registration',
      helperText: `This cancels your confirmed registration and releases ${confirmedSpotNoun}. If this was paid, Evorto submits a Stripe refund when the original payment reference is available; otherwise it creates a pending manual refund record for organizers.`,
    };
  }

  if (registration.status === 'WAITLIST') {
    return {
      buttonLabel: 'Leave waitlist',
      helperText:
        'This removes your waitlist registration and releases your waitlist position.',
    };
  }

  return null;
};

export const registrationDeferredActionCopy = (registration: {
  status: EventsRegistrationStatus;
}): null | string => {
  if (registration.status === 'PENDING') {
    return 'Transfer/resale is not available for pending registrations.';
  }

  if (registration.status === 'WAITLIST') {
    return 'Transfer/resale is not available for waitlist registrations.';
  }

  return null;
};

export const registrationTransferActionCopy = (registration: {
  status: EventsRegistrationStatus;
  transferAvailable: boolean;
}): null | {
  buttonLabel: string;
  helperText: string;
} => {
  if (registration.status !== 'CONFIRMED') {
    return null;
  }

  if (registration.transferAvailable) {
    return {
      buttonLabel: 'Create transfer link',
      helperText:
        'Create a private link and code for one eligible tenant member. They review the current questions, add-ons, discount, and price before claiming it.',
    };
  }

  return {
    buttonLabel: 'Transfer unavailable',
    helperText:
      'Transfer is available only for confirmed, not-yet-checked-in registrations before the configured transfer deadline.',
  };
};

export const registrationCancellationActionDisabled = (input: {
  cancellationPending: boolean;
  transferPending: boolean;
}): boolean => input.cancellationPending || input.transferPending;

export const registrationTransferActionDisabled = (input: {
  cancellationPending: boolean;
  transferAvailable: boolean;
  transferPending: boolean;
}): boolean =>
  !input.transferAvailable ||
  input.cancellationPending ||
  input.transferPending;

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CurrencyPipe, DatePipe, MatButtonModule, NgOptimizedImage],
  selector: 'app-event-active-registration',
  styles: ``,
  templateUrl: './event-active-registration.component.html',
})
export class EventActiveRegistrationComponent {
  public readonly registrations = input.required<
    readonly {
      activeTransfer: null | {
        expiresAt: string;
        registrationSide: 'recipient' | 'source';
        status: 'checkout_pending' | 'open';
        transferId: string;
      };
      addonPurchases: readonly {
        quantity: number;
        title: string;
        unitPrice: number;
      }[];
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
      transferAvailable: boolean;
    }[]
  >();
  protected readonly cancellationCopy = registrationCancellationCopy;
  private readonly rpc = AppRpc.injectClient();
  protected readonly cancelRegistrationMutation = injectMutation(() =>
    this.rpc.events.cancelRegistration.mutationOptions(),
  );
  protected readonly cancelTransferMutation = injectMutation(() =>
    this.rpc.registrationTransfers.cancel.mutationOptions(),
  );
  protected readonly deferredActionCopy = registrationDeferredActionCopy;
  protected readonly recipientTransferCheckoutPending =
    recipientTransferCheckoutPending;
  protected readonly registrationCancellationActionDisabled =
    registrationCancellationActionDisabled;
  protected readonly registrationTransferActionDisabled =
    registrationTransferActionDisabled;
  protected readonly transferActionCopy = registrationTransferActionCopy;
  protected readonly transferRegistrationMutation = injectMutation(() =>
    this.rpc.registrationTransfers.createOffer.mutationOptions(),
  );

  private readonly dialog = inject(MatDialog);
  private readonly queryClient = inject(QueryClient);

  cancelRegistration(registration: {
    activeTransfer: null | {
      registrationSide: 'recipient' | 'source';
      status: 'checkout_pending' | 'open';
    };
    id: string;
    status: EventsRegistrationStatus;
  }) {
    if (
      recipientTransferCheckoutPending(registration) ||
      registrationCancellationActionDisabled({
        cancellationPending: this.cancelRegistrationMutation.isPending(),
        transferPending:
          this.transferRegistrationMutation.isPending() ||
          this.cancelTransferMutation.isPending(),
      })
    ) {
      return;
    }

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

  cancelTransfer(transferId: string): void {
    if (
      this.transferRegistrationMutation.isPending() ||
      this.cancelTransferMutation.isPending()
    ) {
      return;
    }
    this.cancelTransferMutation.mutate(
      { transferId },
      {
        onSuccess: async () => {
          await this.queryClient.invalidateQueries(
            this.rpc.queryFilter(['events', 'getRegistrationStatus']),
          );
        },
      },
    );
  }

  transferRegistration(registration: {
    id: string;
    transferAvailable: boolean;
  }): void {
    if (
      registrationTransferActionDisabled({
        cancellationPending: this.cancelRegistrationMutation.isPending(),
        transferAvailable: registration.transferAvailable,
        transferPending:
          this.transferRegistrationMutation.isPending() ||
          this.cancelTransferMutation.isPending(),
      })
    ) {
      return;
    }

    this.transferRegistrationMutation.mutate(
      {
        registrationId: registration.id,
      },
      {
        onSuccess: async (offer) => {
          this.dialog.open<
            EventRegistrationTransferDialogComponent,
            EventRegistrationTransferDialogData
          >(EventRegistrationTransferDialogComponent, {
            data: offer,
            width: '560px',
          });
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

  protected transferErrorMessage(error: unknown): string {
    return getErrorMessage(error, 'Transfer failed');
  }
}
