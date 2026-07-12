import type { transactions } from '@db/schema';

import {
  RegistrationTransferRefundLifecycle,
  type RegistrationTransferRefundLifecycleState,
  type RegistrationTransferStatus,
} from '@shared/registration-transfer';

export type RegistrationTransferRefundClaim = null | Pick<
  typeof transactions.$inferSelect,
  | 'manuallyCreated'
  | 'method'
  | 'status'
  | 'stripeRefundAttempts'
  | 'stripeRefundClaimLeaseExpiresAt'
  | 'stripeRefundClaimLeaseId'
  | 'stripeRefundMaxAttempts'
  | 'stripeRefundNextAttemptAt'
  | 'stripeRefundStatus'
>;

const refundLifecyclePending = (status: RegistrationTransferStatus): boolean =>
  status === 'compensation_pending' || status === 'refund_pending';

const refundLifecycleFailed = (status: RegistrationTransferStatus): boolean =>
  status === 'compensation_failed' || status === 'refund_failed';

const refundLifecycleState = (
  refund: RegistrationTransferRefundClaim,
): RegistrationTransferRefundLifecycleState => {
  if (!refund) return 'needsAttention';
  if (
    refund.status === 'cancelled' ||
    refund.stripeRefundStatus === 'canceled' ||
    refund.stripeRefundStatus === 'failed'
  ) {
    return 'needsAttention';
  }
  if (refund.method !== 'stripe' || refund.manuallyCreated === true) {
    return 'needsAttention';
  }
  if (
    refund.status === 'successful' ||
    refund.stripeRefundStatus === 'succeeded'
  ) {
    return 'succeeded';
  }
  if (refund.status !== 'pending') return 'needsAttention';
  if (refund.stripeRefundStatus === 'requires_action') {
    return 'actionRequired';
  }

  const leaseShapeValid =
    (refund.stripeRefundClaimLeaseId === null) ===
    (refund.stripeRefundClaimLeaseExpiresAt === null);
  if (!leaseShapeValid) return 'needsAttention';
  const activeLease =
    refund.stripeRefundClaimLeaseId !== null &&
    refund.stripeRefundClaimLeaseExpiresAt !== null;
  if (
    !activeLease &&
    (refund.stripeRefundAttempts >= refund.stripeRefundMaxAttempts ||
      refund.stripeRefundNextAttemptAt === null)
  ) {
    return 'needsAttention';
  }

  return 'processing';
};

export const resolveRegistrationTransferRefundLifecycle = (input: {
  readonly refunds: readonly RegistrationTransferRefundClaim[];
  readonly transferStatus: RegistrationTransferStatus;
}): null | RegistrationTransferRefundLifecycle => {
  if (refundLifecycleFailed(input.transferStatus)) {
    return RegistrationTransferRefundLifecycle.make({
      state: 'needsAttention',
    });
  }
  if (!refundLifecyclePending(input.transferStatus)) return null;

  const states = input.refunds.map((refund) => refundLifecycleState(refund));
  const state: RegistrationTransferRefundLifecycleState = states.includes(
    'needsAttention',
  )
    ? 'needsAttention'
    : states.includes('actionRequired')
      ? 'actionRequired'
      : states.includes('processing')
        ? 'processing'
        : states.length > 0 && states.every((item) => item === 'succeeded')
          ? 'succeeded'
          : 'needsAttention';
  return RegistrationTransferRefundLifecycle.make({ state });
};
