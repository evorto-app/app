import type { RegistrationTransferStatus } from '@shared/registration-transfer';

import { Effect, Schema } from 'effect';

const allowedTransitions: Readonly<
  Record<RegistrationTransferStatus, readonly RegistrationTransferStatus[]>
> = {
  cancelled: [],
  checkout_pending: [
    'open',
    'refund_pending',
    'compensation_pending',
    'completed',
    'cancelled',
    'expired',
  ],
  compensated: [],
  compensation_failed: ['compensation_pending', 'compensated'],
  compensation_pending: ['compensation_failed', 'compensated'],
  completed: [],
  expired: [],
  open: [
    'checkout_pending',
    'refund_pending',
    'completed',
    'cancelled',
    'expired',
  ],
  refund_failed: ['refund_pending', 'completed'],
  refund_pending: ['refund_failed', 'completed'],
};

export interface RegistrationTransferRefundPlan {
  readonly amount: number;
  readonly applicationFeeRefunded: boolean;
}

interface RegistrationTransferSourcePayment {
  readonly amount: number;
  readonly stripeNetAmount: null | number;
}

export class RegistrationTransferStateError extends Schema.TaggedErrorClass<RegistrationTransferStateError>()(
  'RegistrationTransferStateError',
  {
    message: Schema.String,
  },
) {}

const validateDeadlineHours = Effect.fn('validateDeadlineHours')(function* (
  value: number,
  policyName: string,
) {
  if (!Number.isInteger(value) || value < 0) {
    return yield* new RegistrationTransferStateError({
      message: `${policyName} must be a non-negative integer number of hours`,
    });
  }
  return value;
});

export const ensureRegistrationTransferTransition = Effect.fn(
  'ensureRegistrationTransferTransition',
)(function* (from: RegistrationTransferStatus, to: RegistrationTransferStatus) {
  if (!allowedTransitions[from].includes(to)) {
    return yield* new RegistrationTransferStateError({
      message: `Registration transfer cannot move from ${from} to ${to}`,
    });
  }
});

export const resolveRegistrationTransferDeadline = Effect.fn(
  'resolveRegistrationTransferDeadline',
)(function* ({
  eventStart,
  now,
  optionHoursBeforeStart,
  tenantHoursBeforeStart,
}: {
  eventStart: Date;
  now: Date;
  optionHoursBeforeStart: null | number;
  tenantHoursBeforeStart: number;
}) {
  const resolvedHours = yield* validateDeadlineHours(
    optionHoursBeforeStart ?? tenantHoursBeforeStart,
    'Transfer deadline',
  );
  const expiresAt = new Date(
    eventStart.getTime() - resolvedHours * 60 * 60 * 1000,
  );
  if (expiresAt <= now) {
    return yield* new RegistrationTransferStateError({
      message: 'Registration can no longer be transferred',
    });
  }
  return expiresAt;
});

export const resolveRegistrationCancellationDeadline = Effect.fn(
  'resolveRegistrationCancellationDeadline',
)(function* ({
  eventStart,
  optionHoursBeforeStart,
  tenantHoursBeforeStart,
}: {
  eventStart: Date;
  optionHoursBeforeStart: null | number;
  tenantHoursBeforeStart: number;
}) {
  const resolvedHours = yield* validateDeadlineHours(
    optionHoursBeforeStart ?? tenantHoursBeforeStart,
    'Cancellation deadline',
  );
  return new Date(eventStart.getTime() - resolvedHours * 60 * 60 * 1000);
});

export const resolveRegistrationFeeRefund = ({
  optionRefundFees,
  tenantRefundFees,
}: {
  optionRefundFees: boolean | null;
  tenantRefundFees: boolean;
}): boolean => optionRefundFees ?? tenantRefundFees;

export const resolveRegistrationTransferRefundPlan = Effect.fn(
  'resolveRegistrationTransferRefundPlan',
)(function* (
  sourcePayment: RegistrationTransferSourcePayment,
  refundFees: boolean,
) {
  if (!Number.isInteger(sourcePayment.amount) || sourcePayment.amount <= 0) {
    return yield* new RegistrationTransferStateError({
      message: 'Source payment gross amount is unavailable',
    });
  }

  if (refundFees) {
    return {
      amount: sourcePayment.amount,
      applicationFeeRefunded: true,
    } satisfies RegistrationTransferRefundPlan;
  }

  const netAmount = sourcePayment.stripeNetAmount;
  if (
    netAmount === null ||
    !Number.isInteger(netAmount) ||
    netAmount < 0 ||
    netAmount > sourcePayment.amount
  ) {
    return yield* new RegistrationTransferStateError({
      message:
        'Source payment fee settlement is unavailable; retry after Stripe fee reconciliation',
    });
  }

  return {
    amount: netAmount,
    applicationFeeRefunded: false,
  } satisfies RegistrationTransferRefundPlan;
});
