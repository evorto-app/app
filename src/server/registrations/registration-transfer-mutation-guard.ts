import type { DatabaseClient } from '@db/index';

import { registrationTransferEvents, registrationTransfers } from '@db/schema';
import { activeRegistrationTransferStatuses } from '@shared/registration-transfer';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DateTime, Effect, Schema } from 'effect';

type RegistrationTransferGuardTransaction = Pick<
  DatabaseClient,
  'insert' | 'select' | 'update'
>;

export const registrationTransferMutationBlockingStatuses = [
  'open',
  'checkout_pending',
] as const satisfies readonly (typeof activeRegistrationTransferStatuses)[number][];

export class RegistrationTransferMutationConflict extends Schema.TaggedError<RegistrationTransferMutationConflict>()(
  'RegistrationTransferMutationConflict',
  {
    message: Schema.String,
    registrationId: Schema.String,
    status: Schema.Literals(registrationTransferMutationBlockingStatuses),
    transferId: Schema.String,
  },
) {}

export const registrationTransferOpenDeadlinePredicate = (
  table: Pick<typeof registrationTransfers, 'expiresAt' | 'status'>,
) =>
  sql`(${table.status} <> 'open' OR ${table.expiresAt} > statement_timestamp())`;

export const activeRegistrationTransferMutationPredicate = (input: {
  readonly registrationId: string;
  readonly tenantId: string;
}) =>
  and(
    eq(registrationTransfers.tenantId, input.tenantId),
    eq(registrationTransfers.sourceRegistrationId, input.registrationId),
    inArray(
      registrationTransfers.status,
      registrationTransferMutationBlockingStatuses,
    ),
    registrationTransferOpenDeadlinePredicate(registrationTransfers),
  );

export const ensureRegistrationMutationHasNoActiveTransfer = Effect.fn(
  'ensureRegistrationMutationHasNoActiveTransfer',
)(function* (
  tx: RegistrationTransferGuardTransaction,
  input: {
    readonly registrationId: string;
    readonly tenantId: string;
  },
) {
  const transferRows = yield* tx
    .select({
      expiresAt: registrationTransfers.expiresAt,
      id: registrationTransfers.id,
      status: registrationTransfers.status,
    })
    .from(registrationTransfers)
    .where(
      and(
        eq(registrationTransfers.tenantId, input.tenantId),
        eq(registrationTransfers.sourceRegistrationId, input.registrationId),
        inArray(
          registrationTransfers.status,
          registrationTransferMutationBlockingStatuses,
        ),
      ),
    )
    .for('update');
  const transfer = transferRows[0];
  if (
    !transfer ||
    (transfer.status !== 'open' && transfer.status !== 'checkout_pending')
  ) {
    return;
  }

  const now = yield* DateTime.nowAsDate;
  if (transfer.status === 'open' && transfer.expiresAt <= now) {
    const expired = yield* tx
      .update(registrationTransfers)
      .set({ expiredAt: now, status: 'expired' })
      .where(
        and(
          eq(registrationTransfers.id, transfer.id),
          eq(registrationTransfers.status, 'open'),
          eq(registrationTransfers.tenantId, input.tenantId),
        ),
      )
      .returning({ id: registrationTransfers.id });
    if (expired.length !== 1) {
      return yield* Effect.die(
        new Error('Locked transfer offer could not be expired'),
      );
    }
    yield* tx.insert(registrationTransferEvents).values({
      eventType: 'expired',
      fromStatus: 'open',
      tenantId: input.tenantId,
      toStatus: 'expired',
      transferId: transfer.id,
    });
    return;
  }

  return yield* new RegistrationTransferMutationConflict({
    message:
      'Cancel the active transfer offer before changing, cancelling, or checking in this registration.',
    registrationId: input.registrationId,
    status: transfer.status,
    transferId: transfer.id,
  });
});
