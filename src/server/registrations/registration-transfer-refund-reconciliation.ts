import type { DatabaseClient } from '@db/index';

import {
  registrationTransferEvents,
  registrationTransfers,
  transactions,
} from '@db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

export type RegistrationTransferRefundReconciliationStatus =
  'alreadyReconciled' | 'notTransfer' | 'reconciled' | 'unchanged';

export type RegistrationTransferRefundRequeueStatus =
  'alreadyPending' | 'notTransfer' | 'requeued';

interface RegistrationTransferRefundIdentity {
  readonly refundTransactionId: string;
  readonly stripeRefundStatus: typeof transactions.$inferSelect.stripeRefundStatus;
}

type RegistrationTransferTransaction = Pick<
  DatabaseClient,
  'insert' | 'select' | 'update'
>;

export const markRegistrationTransferRefundRequeued = Effect.fn(
  'markRegistrationTransferRefundRequeued',
)(function* (
  tx: RegistrationTransferTransaction,
  input: {
    readonly reason: string;
    readonly refundTransactionId: string;
    readonly tenantId: string;
  },
) {
  const reason = input.reason.trim();
  if (!reason) return 'notTransfer' as const;
  const transferRows = yield* tx
    .select({
      id: registrationTransfers.id,
      status: registrationTransfers.status,
      tenantId: registrationTransfers.tenantId,
    })
    .from(registrationTransfers)
    .where(
      and(
        eq(
          registrationTransfers.refundTransactionId,
          input.refundTransactionId,
        ),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const transfer = transferRows[0];
  if (!transfer) return 'notTransfer' as const;
  if (
    transfer.status === 'compensation_pending' ||
    transfer.status === 'refund_pending'
  ) {
    return 'alreadyPending' as const;
  }
  if (
    transfer.status !== 'compensation_failed' &&
    transfer.status !== 'refund_failed'
  ) {
    return 'notTransfer' as const;
  }

  const compensation = transfer.status === 'compensation_failed';
  const pendingStatus = compensation
    ? ('compensation_pending' as const)
    : ('refund_pending' as const);

  const requeued = yield* tx
    .update(registrationTransfers)
    .set({ lastError: null, status: pendingStatus })
    .where(
      and(
        eq(registrationTransfers.id, transfer.id),
        eq(
          registrationTransfers.refundTransactionId,
          input.refundTransactionId,
        ),
        eq(registrationTransfers.status, transfer.status),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .returning({ id: registrationTransfers.id });
  if (requeued.length !== 1) return 'notTransfer' as const;
  yield* tx.insert(registrationTransferEvents).values({
    eventType: compensation ? 'compensation_requeued' : 'refund_requeued',
    fromStatus: transfer.status,
    reason,
    tenantId: transfer.tenantId,
    toStatus: pendingStatus,
    transferId: transfer.id,
  });
  return 'requeued' as const;
});

export const reconcileRegistrationTransferRefund = Effect.fn(
  'reconcileRegistrationTransferRefund',
)(function* (
  tx: RegistrationTransferTransaction,
  input: RegistrationTransferRefundIdentity,
) {
  const transferRows = yield* tx
    .select({
      id: registrationTransfers.id,
      status: registrationTransfers.status,
      tenantId: registrationTransfers.tenantId,
    })
    .from(registrationTransfers)
    .where(
      eq(registrationTransfers.refundTransactionId, input.refundTransactionId),
    )
    .for('update');
  const transfer = transferRows[0];
  if (!transfer) return 'notTransfer' as const;
  if (transfer.status === 'compensated' || transfer.status === 'completed') {
    return 'alreadyReconciled' as const;
  }
  if (
    transfer.status !== 'compensation_failed' &&
    transfer.status !== 'compensation_pending' &&
    transfer.status !== 'refund_failed' &&
    transfer.status !== 'refund_pending'
  ) {
    return 'notTransfer' as const;
  }

  const reconciledAt = new Date();
  if (input.stripeRefundStatus === 'succeeded') {
    const compensation =
      transfer.status === 'compensation_failed' ||
      transfer.status === 'compensation_pending';
    const completedStatus = compensation
      ? ('compensated' as const)
      : ('completed' as const);
    yield* tx
      .update(registrationTransfers)
      .set({
        completedAt: reconciledAt,
        ...(compensation && { compensatedAt: reconciledAt }),
        lastError: null,
        refundCompletedAt: reconciledAt,
        status: completedStatus,
      })
      .where(
        and(
          eq(registrationTransfers.id, transfer.id),
          eq(
            registrationTransfers.refundTransactionId,
            input.refundTransactionId,
          ),
          inArray(registrationTransfers.status, [
            'compensation_failed',
            'compensation_pending',
            'refund_failed',
            'refund_pending',
          ]),
        ),
      );
    yield* tx.insert(registrationTransferEvents).values({
      eventType: compensation ? 'compensation_completed' : 'refund_completed',
      fromStatus: transfer.status,
      tenantId: transfer.tenantId,
      toStatus: completedStatus,
      transferId: transfer.id,
    });
    return 'reconciled' as const;
  }

  if (
    input.stripeRefundStatus === 'canceled' ||
    input.stripeRefundStatus === 'failed'
  ) {
    if (
      transfer.status === 'compensation_pending' ||
      transfer.status === 'refund_pending'
    ) {
      const compensation = transfer.status === 'compensation_pending';
      const failedStatus = compensation
        ? ('compensation_failed' as const)
        : ('refund_failed' as const);
      yield* tx
        .update(registrationTransfers)
        .set({
          lastError: `Stripe refund reached terminal status ${input.stripeRefundStatus}`,
          status: failedStatus,
        })
        .where(
          and(
            eq(registrationTransfers.id, transfer.id),
            eq(
              registrationTransfers.refundTransactionId,
              input.refundTransactionId,
            ),
            eq(registrationTransfers.status, transfer.status),
          ),
        );
      yield* tx.insert(registrationTransferEvents).values({
        eventType: compensation ? 'compensation_failed' : 'refund_failed',
        fromStatus: transfer.status,
        reason: `Stripe refund reached terminal status ${input.stripeRefundStatus}`,
        tenantId: transfer.tenantId,
        toStatus: failedStatus,
        transferId: transfer.id,
      });
      return 'reconciled' as const;
    }
    return 'alreadyReconciled' as const;
  }

  return 'unchanged' as const;
});
