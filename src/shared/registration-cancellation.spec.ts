import { describe, expect, it } from 'vitest';

import {
  registrationCancellationActionLabel,
  registrationCancellationCompletedLabel,
  registrationCancellationFailureMessage,
  registrationCancellationKind,
} from './registration-cancellation';

describe('registrationCancellationKind', () => {
  it.each([
    ['PENDING', false, 'application'],
    ['PENDING', true, 'pendingSignUp'],
    ['WAITLIST', false, 'waitlist'],
    ['CONFIRMED', false, 'ticket'],
  ] as const)(
    'maps %s with payment pending %s to %s',
    (status, paymentPending, expected) => {
      expect(registrationCancellationKind({ paymentPending, status })).toBe(
        expected,
      );
    },
  );
});

it('gives every cancellation kind a specific recovery message', () => {
  expect(registrationCancellationFailureMessage('application')).toContain(
    'application could not be withdrawn',
  );
  expect(registrationCancellationFailureMessage('pendingSignUp')).toContain(
    'pending sign-up could not be cancelled',
  );
  expect(registrationCancellationFailureMessage('ticket')).toContain(
    'ticket could not be cancelled',
  );
  expect(registrationCancellationFailureMessage('waitlist')).toContain(
    'waitlist place could not be removed',
  );
});

describe('registration cancellation labels', () => {
  it.each([
    ['application', 'Withdraw application', 'Application withdrawn'],
    ['pendingSignUp', 'Cancel sign-up', 'Sign-up cancelled'],
    ['ticket', 'Cancel ticket', 'Ticket cancelled'],
    ['waitlist', 'Remove from waitlist', 'Waitlist place removed'],
  ] as const)('describes %s in product language', (kind, action, completed) => {
    expect(registrationCancellationActionLabel(kind)).toBe(action);
    expect(registrationCancellationCompletedLabel(kind)).toBe(completed);
  });
});
