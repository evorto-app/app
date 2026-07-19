import { isPersistableNonNegativeInteger } from '../payments/payment-amount';

export interface RegistrationTransferPriorRefund {
  readonly amount: number;
  readonly currency: string;
  readonly eventId: null | string;
  readonly eventRegistrationId: null | string;
  readonly manuallyCreated: boolean | null;
  readonly method: string;
  readonly sourceTransactionId: null | string;
  readonly status: string;
  readonly stripeAccountId: null | string;
  readonly stripeRefundId: null | string;
  readonly stripeRefundStatus: null | string;
  readonly targetUserId: null | string;
}

export type RegistrationTransferPriorRefundResolution =
  | {
      readonly _tag: 'InvalidAmount';
    }
  | {
      readonly _tag: 'InvalidProvenance';
    }
  | {
      readonly _tag: 'Unresolved';
    }
  | {
      readonly _tag: 'Valid';
      readonly refundedBySourceTransactionId: ReadonlyMap<string, number>;
    };

export interface RegistrationTransferSourcePayment {
  readonly amount: number;
  readonly currency: string;
  readonly eventId: null | string;
  readonly eventRegistrationId: null | string;
  readonly id: string;
  readonly stripeAccountId: null | string;
  readonly targetUserId: null | string;
}

/**
 * Counts only completed Stripe refunds that retain the exact source payment's
 * user, account, currency, event, and registration ownership.
 */
export const resolveRegistrationTransferPriorRefunds = (input: {
  readonly refunds: readonly RegistrationTransferPriorRefund[];
  readonly sourcePayments: readonly RegistrationTransferSourcePayment[];
}): RegistrationTransferPriorRefundResolution => {
  const sourcePaymentById = new Map(
    input.sourcePayments.map((payment) => [payment.id, payment]),
  );
  if (
    sourcePaymentById.size !== input.sourcePayments.length ||
    input.sourcePayments.some(
      (payment) =>
        !isPersistableNonNegativeInteger(payment.amount) ||
        payment.amount === 0 ||
        !payment.eventId ||
        !payment.eventRegistrationId ||
        !payment.stripeAccountId ||
        !payment.targetUserId,
    )
  ) {
    return { _tag: 'InvalidProvenance' };
  }

  const refundedBySource = new Map<string, bigint>();
  for (const refund of input.refunds) {
    if (
      refund.status === 'cancelled' &&
      (refund.stripeRefundStatus === 'canceled' ||
        refund.stripeRefundStatus === 'failed')
    ) {
      continue;
    }
    if (
      refund.method !== 'stripe' ||
      refund.status !== 'successful' ||
      refund.stripeRefundStatus !== 'succeeded'
    ) {
      return { _tag: 'Unresolved' };
    }
    const sourceTransactionId = refund.sourceTransactionId;
    if (!sourceTransactionId) {
      return { _tag: 'InvalidProvenance' };
    }
    const source = sourcePaymentById.get(sourceTransactionId);
    if (
      !source ||
      refund.manuallyCreated !== false ||
      !refund.stripeRefundId?.trim() ||
      refund.currency !== source.currency ||
      refund.eventId !== source.eventId ||
      refund.eventRegistrationId !== source.eventRegistrationId ||
      refund.stripeAccountId !== source.stripeAccountId ||
      refund.targetUserId !== source.targetUserId
    ) {
      return { _tag: 'InvalidProvenance' };
    }
    if (
      !Number.isSafeInteger(refund.amount) ||
      refund.amount >= 0 ||
      !isPersistableNonNegativeInteger(-refund.amount)
    ) {
      return { _tag: 'InvalidAmount' };
    }
    refundedBySource.set(
      sourceTransactionId,
      (refundedBySource.get(sourceTransactionId) ?? 0n) - BigInt(refund.amount),
    );
  }

  const result = new Map<string, number>();
  for (const source of input.sourcePayments) {
    const refunded = refundedBySource.get(source.id) ?? 0n;
    if (refunded > BigInt(source.amount)) {
      return { _tag: 'InvalidAmount' };
    }
    result.set(source.id, Number(refunded));
  }
  return {
    _tag: 'Valid',
    refundedBySourceTransactionId: result,
  };
};
