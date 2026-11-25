import type { DatabaseClient } from '@db/index';

import {
  registrationTransferEvents,
  registrationTransferRefundPlanItems,
  registrationTransfers,
  transactions,
} from '@db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect } from 'effect';

export type RegistrationTransferRefundReconciliationStatus =
  'alreadyReconciled' | 'notTransfer' | 'reconciled' | 'unchanged';

const reconciliationAlreadyReconciled =
  'alreadyReconciled' satisfies RegistrationTransferRefundReconciliationStatus;
const refundNotTransfer =
  'notTransfer' satisfies RegistrationTransferRefundReconciliationStatus;
const reconciliationReconciled =
  'reconciled' satisfies RegistrationTransferRefundReconciliationStatus;
const reconciliationUnchanged =
  'unchanged' satisfies RegistrationTransferRefundReconciliationStatus;

export type RegistrationTransferSourceRefundAggregate =
  'failed' | 'pending' | 'succeeded';

export interface RegistrationTransferSourceRefundPlanItemState {
  readonly refundAmountDue: number;
  readonly refundTransactionId: null | string;
  readonly status: null | typeof transactions.$inferSelect.status;
  readonly stripeRefundStatus:
    null | typeof transactions.$inferSelect.stripeRefundStatus;
}

interface RegistrationTransferRefundIdentity {
  readonly refundTransactionId: string;
  readonly stripeRefundStatus: typeof transactions.$inferSelect.stripeRefundStatus;
}

type RegistrationTransferTransaction = Pick<
  DatabaseClient,
  'insert' | 'select' | 'update'
>;

const sourceRefundClaimSucceeded = (
  item: RegistrationTransferSourceRefundPlanItemState,
): boolean =>
  item.status === 'successful' && item.stripeRefundStatus === 'succeeded';

const sourceRefundClaimFailed = (
  item: RegistrationTransferSourceRefundPlanItemState,
): boolean =>
  item.refundTransactionId === null ||
  item.status === null ||
  item.status === 'cancelled' ||
  item.stripeRefundStatus === 'canceled' ||
  item.stripeRefundStatus === 'failed';

export const registrationTransferSourceRefundAggregate = (
  items: readonly RegistrationTransferSourceRefundPlanItemState[],
): RegistrationTransferSourceRefundAggregate => {
  let pending = false;
  for (const item of items) {
    if (item.refundAmountDue === 0) continue;
    if (sourceRefundClaimFailed(item)) return 'failed';
    if (!sourceRefundClaimSucceeded(item)) pending = true;
  }
  return pending ? 'pending' : 'succeeded';
};

const loadRegistrationTransferRefundMapping = Effect.fn(
  'loadRegistrationTransferRefundMapping',
)(function* (
  tx: RegistrationTransferTransaction,
  input: {
    readonly refundTransactionId: string;
    readonly tenantId: null | string;
  },
) {
  const compensationRows = yield* tx
    .select({
      id: registrationTransfers.id,
      status: registrationTransfers.status,
      tenantId: registrationTransfers.tenantId,
    })
    .from(registrationTransfers)
    .innerJoin(
      transactions,
      and(
        eq(
          transactions.id,
          registrationTransfers.compensationRefundTransactionId,
        ),
        eq(transactions.tenantId, registrationTransfers.tenantId),
        eq(transactions.type, 'refund'),
      ),
    )
    .where(
      and(
        eq(
          registrationTransfers.compensationRefundTransactionId,
          input.refundTransactionId,
        ),
        input.tenantId === null
          ? eq(transactions.id, input.refundTransactionId)
          : eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .for('update');

  const sourceRows = yield* tx
    .select({
      id: registrationTransfers.id,
      status: registrationTransfers.status,
      tenantId: registrationTransfers.tenantId,
    })
    .from(registrationTransferRefundPlanItems)
    .innerJoin(
      registrationTransfers,
      and(
        eq(
          registrationTransfers.id,
          registrationTransferRefundPlanItems.transferId,
        ),
        eq(
          registrationTransfers.tenantId,
          registrationTransferRefundPlanItems.tenantId,
        ),
      ),
    )
    .innerJoin(
      transactions,
      and(
        eq(
          transactions.id,
          registrationTransferRefundPlanItems.refundTransactionId,
        ),
        eq(transactions.tenantId, registrationTransferRefundPlanItems.tenantId),
        eq(transactions.type, 'refund'),
      ),
    )
    .where(
      and(
        eq(
          registrationTransferRefundPlanItems.refundTransactionId,
          input.refundTransactionId,
        ),
        input.tenantId === null
          ? eq(transactions.id, input.refundTransactionId)
          : eq(registrationTransferRefundPlanItems.tenantId, input.tenantId),
      ),
    )
    .for('update');

  if (compensationRows.length + sourceRows.length !== 1) return null;
  const compensation = compensationRows[0];
  if (compensation) {
    return { kind: 'compensation', transfer: compensation } as const;
  }
  const source = sourceRows[0];
  return source ? ({ kind: 'source', transfer: source } as const) : null;
});

const loadSourceRefundPlanItemStates = Effect.fn(
  'loadSourceRefundPlanItemStates',
)(function* (
  tx: RegistrationTransferTransaction,
  transfer: { readonly id: string; readonly tenantId: string },
) {
  return yield* tx
    .select({
      refundAmountDue: registrationTransferRefundPlanItems.refundAmountDue,
      refundTransactionId:
        registrationTransferRefundPlanItems.refundTransactionId,
      status: transactions.status,
      stripeRefundStatus: transactions.stripeRefundStatus,
    })
    .from(registrationTransferRefundPlanItems)
    .leftJoin(
      transactions,
      and(
        eq(
          transactions.id,
          registrationTransferRefundPlanItems.refundTransactionId,
        ),
        eq(transactions.tenantId, registrationTransferRefundPlanItems.tenantId),
        eq(transactions.type, 'refund'),
      ),
    )
    .where(
      and(
        eq(registrationTransferRefundPlanItems.transferId, transfer.id),
        eq(registrationTransferRefundPlanItems.tenantId, transfer.tenantId),
      ),
    );
});

const insertTransferRefundEvent = Effect.fn('insertTransferRefundEvent')(
  function* (
    tx: RegistrationTransferTransaction,
    input: {
      readonly eventType:
        | 'compensation_completed'
        | 'compensation_failed'
        | 'compensation_requeued'
        | 'refund_completed'
        | 'refund_failed'
        | 'refund_requeued';
      readonly fromStatus: typeof registrationTransfers.$inferSelect.status;
      readonly reason?: string;
      readonly tenantId: string;
      readonly toStatus: typeof registrationTransfers.$inferSelect.status;
      readonly transferId: string;
    },
  ) {
    yield* tx.insert(registrationTransferEvents).values(input);
  },
);

const reconcileCompensationRefund = Effect.fn('reconcileCompensationRefund')(
  function* (
    tx: RegistrationTransferTransaction,
    input: RegistrationTransferRefundIdentity,
    transfer: {
      readonly id: string;
      readonly status: typeof registrationTransfers.$inferSelect.status;
      readonly tenantId: string;
    },
  ) {
    if (transfer.status === 'compensated') {
      return reconciliationAlreadyReconciled;
    }
    if (
      transfer.status !== 'compensation_failed' &&
      transfer.status !== 'compensation_pending'
    ) {
      return refundNotTransfer;
    }

    if (input.stripeRefundStatus === 'succeeded') {
      const reconciledAt = new Date();
      const completed = yield* tx
        .update(registrationTransfers)
        .set({
          compensatedAt: reconciledAt,
          completedAt: reconciledAt,
          lastError: null,
          refundCompletedAt: reconciledAt,
          status: 'compensated',
        })
        .where(
          and(
            eq(registrationTransfers.id, transfer.id),
            eq(
              registrationTransfers.compensationRefundTransactionId,
              input.refundTransactionId,
            ),
            inArray(registrationTransfers.status, [
              'compensation_failed',
              'compensation_pending',
            ]),
            eq(registrationTransfers.tenantId, transfer.tenantId),
          ),
        )
        .returning({ id: registrationTransfers.id });
      if (completed.length !== 1) return reconciliationAlreadyReconciled;
      yield* insertTransferRefundEvent(tx, {
        eventType: 'compensation_completed',
        fromStatus: transfer.status,
        tenantId: transfer.tenantId,
        toStatus: 'compensated',
        transferId: transfer.id,
      });
      return reconciliationReconciled;
    }

    if (
      input.stripeRefundStatus !== 'canceled' &&
      input.stripeRefundStatus !== 'failed'
    ) {
      return reconciliationUnchanged;
    }
    if (transfer.status === 'compensation_failed') {
      return reconciliationAlreadyReconciled;
    }

    const reason = `Stripe refund reached terminal status ${input.stripeRefundStatus}`;
    const failed = yield* tx
      .update(registrationTransfers)
      .set({ lastError: reason, status: 'compensation_failed' })
      .where(
        and(
          eq(registrationTransfers.id, transfer.id),
          eq(
            registrationTransfers.compensationRefundTransactionId,
            input.refundTransactionId,
          ),
          eq(registrationTransfers.status, 'compensation_pending'),
          eq(registrationTransfers.tenantId, transfer.tenantId),
        ),
      )
      .returning({ id: registrationTransfers.id });
    if (failed.length !== 1) return reconciliationAlreadyReconciled;
    yield* insertTransferRefundEvent(tx, {
      eventType: 'compensation_failed',
      fromStatus: 'compensation_pending',
      reason,
      tenantId: transfer.tenantId,
      toStatus: 'compensation_failed',
      transferId: transfer.id,
    });
    return reconciliationReconciled;
  },
);

const reconcileSourceRefund = Effect.fn('reconcileSourceRefund')(function* (
  tx: RegistrationTransferTransaction,
  transfer: {
    readonly id: string;
    readonly status: typeof registrationTransfers.$inferSelect.status;
    readonly tenantId: string;
  },
) {
  if (transfer.status === 'completed') return reconciliationAlreadyReconciled;
  if (
    transfer.status !== 'refund_failed' &&
    transfer.status !== 'refund_pending'
  ) {
    return refundNotTransfer;
  }

  const siblingItems = yield* loadSourceRefundPlanItemStates(tx, transfer);
  const aggregate = registrationTransferSourceRefundAggregate(siblingItems);
  if (aggregate === 'pending') return reconciliationUnchanged;

  if (aggregate === 'succeeded') {
    const reconciledAt = new Date();
    const completed = yield* tx
      .update(registrationTransfers)
      .set({
        completedAt: reconciledAt,
        lastError: null,
        refundCompletedAt: reconciledAt,
        status: 'completed',
      })
      .where(
        and(
          eq(registrationTransfers.id, transfer.id),
          inArray(registrationTransfers.status, [
            'refund_failed',
            'refund_pending',
          ]),
          eq(registrationTransfers.tenantId, transfer.tenantId),
        ),
      )
      .returning({ id: registrationTransfers.id });
    if (completed.length !== 1) return reconciliationAlreadyReconciled;
    yield* insertTransferRefundEvent(tx, {
      eventType: 'refund_completed',
      fromStatus: transfer.status,
      tenantId: transfer.tenantId,
      toStatus: 'completed',
      transferId: transfer.id,
    });
    return reconciliationReconciled;
  }

  if (transfer.status === 'refund_failed') {
    return reconciliationAlreadyReconciled;
  }
  const reason =
    'One or more source refunds reached a terminal or incomplete state';
  const failed = yield* tx
    .update(registrationTransfers)
    .set({ lastError: reason, status: 'refund_failed' })
    .where(
      and(
        eq(registrationTransfers.id, transfer.id),
        eq(registrationTransfers.status, 'refund_pending'),
        eq(registrationTransfers.tenantId, transfer.tenantId),
      ),
    )
    .returning({ id: registrationTransfers.id });
  if (failed.length !== 1) return reconciliationAlreadyReconciled;
  yield* insertTransferRefundEvent(tx, {
    eventType: 'refund_failed',
    fromStatus: 'refund_pending',
    reason,
    tenantId: transfer.tenantId,
    toStatus: 'refund_failed',
    transferId: transfer.id,
  });
  return reconciliationReconciled;
});

export const reconcileRegistrationTransferRefund = Effect.fn(
  'reconcileRegistrationTransferRefund',
)(function* (
  tx: RegistrationTransferTransaction,
  input: RegistrationTransferRefundIdentity,
) {
  const mapping = yield* loadRegistrationTransferRefundMapping(tx, {
    refundTransactionId: input.refundTransactionId,
    tenantId: null,
  });
  if (!mapping) return refundNotTransfer;
  return mapping.kind === 'compensation'
    ? yield* reconcileCompensationRefund(tx, input, mapping.transfer)
    : yield* reconcileSourceRefund(tx, mapping.transfer);
});
