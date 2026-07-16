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

export type RegistrationTransferRefundRequeueStatus =
  'alreadyPending' | 'notTransfer' | 'requeued';

const requeueAlreadyPending =
  'alreadyPending' satisfies RegistrationTransferRefundRequeueStatus;
const reconciliationAlreadyReconciled =
  'alreadyReconciled' satisfies RegistrationTransferRefundReconciliationStatus;
const refundNotTransfer = 'notTransfer' satisfies
  | RegistrationTransferRefundReconciliationStatus
  | RegistrationTransferRefundRequeueStatus;
const reconciliationReconciled =
  'reconciled' satisfies RegistrationTransferRefundReconciliationStatus;
const requeueRequeued =
  'requeued' satisfies RegistrationTransferRefundRequeueStatus;
const reconciliationUnchanged =
  'unchanged' satisfies RegistrationTransferRefundReconciliationStatus;

export type RegistrationTransferRefundRecoveryLookup =
  | {
      readonly kind: 'compensation' | 'source';
      readonly status: 'matched';
      readonly transfer: {
        readonly id: string;
        readonly status: typeof registrationTransfers.$inferSelect.status;
        readonly tenantId: string;
      };
    }
  | { readonly status: 'ambiguous' }
  | { readonly status: 'notTransfer' };

export interface RegistrationTransferRefundRecoveryTarget {
  readonly kind: 'compensation' | 'source';
  readonly transferId: string;
}

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

/**
 * Resolves the transfer linked to a validated refund transaction and locks only
 * that transfer row. The caller must already hold a row lock on the refund
 * transaction so a concurrent writer cannot attach a new transfer link between
 * the candidate lookup and the transfer lock.
 */
export const lockRegistrationTransferRefundForRecovery = Effect.fn(
  'lockRegistrationTransferRefundForRecovery',
)(function* (
  tx: RegistrationTransferTransaction,
  input: { readonly refundTransactionId: string; readonly tenantId: string },
) {
  const compensationLinks = yield* tx
    .select({ id: registrationTransfers.id })
    .from(registrationTransfers)
    .where(
      and(
        eq(
          registrationTransfers.compensationRefundTransactionId,
          input.refundTransactionId,
        ),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    );
  const sourceLinks = yield* tx
    .select({ transferId: registrationTransferRefundPlanItems.transferId })
    .from(registrationTransferRefundPlanItems)
    .where(
      and(
        eq(
          registrationTransferRefundPlanItems.refundTransactionId,
          input.refundTransactionId,
        ),
        eq(registrationTransferRefundPlanItems.tenantId, input.tenantId),
      ),
    );
  const links = [
    ...compensationLinks.map(({ id }) => ({
      id,
      kind: 'compensation' as const,
    })),
    ...sourceLinks.map(({ transferId }) => ({
      id: transferId,
      kind: 'source' as const,
    })),
  ];
  if (links.length === 0) {
    return {
      status: 'notTransfer',
    } satisfies RegistrationTransferRefundRecoveryLookup;
  }
  if (links.length !== 1) {
    return {
      status: 'ambiguous',
    } satisfies RegistrationTransferRefundRecoveryLookup;
  }

  const link = links[0];
  const transferRows = yield* tx
    .select({
      id: registrationTransfers.id,
      status: registrationTransfers.status,
      tenantId: registrationTransfers.tenantId,
    })
    .from(registrationTransfers)
    .where(
      and(
        eq(registrationTransfers.id, link.id),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .for('update');
  const transfer = transferRows[0];
  if (!transfer || transferRows.length !== 1) {
    return {
      status: 'ambiguous',
    } satisfies RegistrationTransferRefundRecoveryLookup;
  }
  return {
    kind: link.kind,
    status: 'matched',
    transfer,
  } satisfies RegistrationTransferRefundRecoveryLookup;
});

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

export const markRegistrationTransferRefundRequeued = Effect.fn(
  'markRegistrationTransferRefundRequeued',
)(function* (
  tx: RegistrationTransferTransaction,
  input: {
    readonly expectedTransfer: null | RegistrationTransferRefundRecoveryTarget;
    readonly reason: string;
    readonly refundTransactionId: string;
    readonly tenantId: string;
  },
) {
  const reason = input.reason.trim();
  if (!reason || !input.expectedTransfer) return refundNotTransfer;
  const mapping = yield* loadRegistrationTransferRefundMapping(tx, {
    refundTransactionId: input.refundTransactionId,
    tenantId: input.tenantId,
  });
  if (
    !mapping ||
    mapping.kind !== input.expectedTransfer.kind ||
    mapping.transfer.id !== input.expectedTransfer.transferId
  ) {
    return refundNotTransfer;
  }

  const transfer = mapping.transfer;
  if (mapping.kind === 'compensation') {
    if (transfer.status === 'compensation_pending') {
      return requeueAlreadyPending;
    }
    if (transfer.status !== 'compensation_failed') return refundNotTransfer;

    const requeued = yield* tx
      .update(registrationTransfers)
      .set({ lastError: null, status: 'compensation_pending' })
      .where(
        and(
          eq(registrationTransfers.id, transfer.id),
          eq(
            registrationTransfers.compensationRefundTransactionId,
            input.refundTransactionId,
          ),
          eq(registrationTransfers.status, 'compensation_failed'),
          eq(registrationTransfers.tenantId, input.tenantId),
        ),
      )
      .returning({ id: registrationTransfers.id });
    if (requeued.length !== 1) return refundNotTransfer;
    yield* insertTransferRefundEvent(tx, {
      eventType: 'compensation_requeued',
      fromStatus: 'compensation_failed',
      reason,
      tenantId: transfer.tenantId,
      toStatus: 'compensation_pending',
      transferId: transfer.id,
    });
    return requeueRequeued;
  }

  if (
    transfer.status !== 'refund_failed' &&
    transfer.status !== 'refund_pending'
  ) {
    return refundNotTransfer;
  }
  const siblingItems = yield* loadSourceRefundPlanItemStates(tx, transfer);
  const aggregate = registrationTransferSourceRefundAggregate(siblingItems);
  if (transfer.status === 'refund_pending' && aggregate !== 'failed') {
    return requeueAlreadyPending;
  }
  if (aggregate === 'failed') {
    if (transfer.status === 'refund_pending') {
      const failed = yield* tx
        .update(registrationTransfers)
        .set({
          lastError:
            'One or more source refunds still require operator attention',
          status: 'refund_failed',
        })
        .where(
          and(
            eq(registrationTransfers.id, transfer.id),
            eq(registrationTransfers.status, 'refund_pending'),
            eq(registrationTransfers.tenantId, input.tenantId),
          ),
        )
        .returning({ id: registrationTransfers.id });
      if (failed.length !== 1) return refundNotTransfer;
      yield* insertTransferRefundEvent(tx, {
        eventType: 'refund_failed',
        fromStatus: 'refund_pending',
        reason: 'One or more source refunds still require operator attention',
        tenantId: transfer.tenantId,
        toStatus: 'refund_failed',
        transferId: transfer.id,
      });
    }
    return requeueRequeued;
  }

  const requeued = yield* tx
    .update(registrationTransfers)
    .set({ lastError: null, status: 'refund_pending' })
    .where(
      and(
        eq(registrationTransfers.id, transfer.id),
        eq(registrationTransfers.status, 'refund_failed'),
        eq(registrationTransfers.tenantId, input.tenantId),
      ),
    )
    .returning({ id: registrationTransfers.id });
  if (requeued.length !== 1) return refundNotTransfer;
  yield* insertTransferRefundEvent(tx, {
    eventType: 'refund_requeued',
    fromStatus: 'refund_failed',
    reason,
    tenantId: transfer.tenantId,
    toStatus: 'refund_pending',
    transferId: transfer.id,
  });
  return requeueRequeued;
});

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
