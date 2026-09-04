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
      return 'The application could not be withdrawn. Check its current status and try again.';
    }
    case 'pendingSignUp': {
      return 'The pending sign-up could not be cancelled. Check its current status and try again.';
    }
    case 'ticket': {
      return 'The ticket could not be cancelled. Check its current status and try again.';
    }
    case 'waitlist': {
      return 'The waitlist place could not be removed. Check its current status and try again.';
    }
  }
};
