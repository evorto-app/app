import type { EventsCancellableRegistrationStatus } from './rpc-contracts/app-rpcs/events.rpcs';

export type RegistrationCancellationKind =
  'application' | 'pendingSignUp' | 'ticket' | 'waitlist';

export const registrationCancellationKind = ({
  paymentPending,
  status,
}: {
  readonly paymentPending: boolean;
  readonly status: EventsCancellableRegistrationStatus;
}): RegistrationCancellationKind => {
  if (status === 'CONFIRMED') return 'ticket';
  if (status === 'WAITLIST') return 'waitlist';
  return paymentPending ? 'pendingSignUp' : 'application';
};

export const registrationCancellationActionLabel = (
  kind: RegistrationCancellationKind,
): string => {
  switch (kind) {
    case 'application': {
      return 'Withdraw application';
    }
    case 'pendingSignUp': {
      return 'Cancel sign-up';
    }
    case 'ticket': {
      return 'Cancel ticket';
    }
    case 'waitlist': {
      return 'Remove from waitlist';
    }
  }
};

export const registrationCancellationCompletedLabel = (
  kind: RegistrationCancellationKind,
): string => {
  switch (kind) {
    case 'application': {
      return 'Application withdrawn';
    }
    case 'pendingSignUp': {
      return 'Sign-up cancelled';
    }
    case 'ticket': {
      return 'Ticket cancelled';
    }
    case 'waitlist': {
      return 'Waitlist place removed';
    }
  }
};

export const registrationCancellationFailureMessage = (
  kind: RegistrationCancellationKind,
): string => {
  switch (kind) {
    case 'application': {
      return 'Evorto could not confirm whether the application was withdrawn. Load the page again to check its current status before trying again.';
    }
    case 'pendingSignUp': {
      return 'Evorto could not confirm whether the pending sign-up was cancelled. Load the page again to check its current status before trying again.';
    }
    case 'ticket': {
      return 'Evorto could not confirm whether the ticket was cancelled. Load the page again to check its current status before trying again.';
    }
    case 'waitlist': {
      return 'Evorto could not confirm whether the waitlist place was removed. Load the page again to check its current status before trying again.';
    }
  }
};
