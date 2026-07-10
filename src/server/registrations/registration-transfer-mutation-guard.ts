import type { DatabaseClient } from '@db/index';

import { registrationTransfers } from '@db/schema';
import {
  activeRegistrationTransferStatuses,
  isActiveRegistrationTransferStatus,
} from '@shared/registration-transfer';
import { and, eq, inArray, or } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

type RegistrationTransferGuardTransaction = Pick<DatabaseClient, 'select'>;

export class RegistrationTransferMutationConflict extends Schema.TaggedErrorClass<RegistrationTransferMutationConflict>()(
  'RegistrationTransferMutationConflict',
  {
    message: Schema.String,
    registrationId: Schema.String,
    registrationSide: Schema.Literals(['recipient', 'source']),
    status: Schema.Literals(activeRegistrationTransferStatuses),
    transferId: Schema.String,
  },
) {}

export const activeRegistrationTransferMutationPredicate = (input: {
  readonly registrationId: string;
  readonly tenantId: string;
}) =>
  and(
    eq(registrationTransfers.tenantId, input.tenantId),
    or(
      and(
        eq(registrationTransfers.sourceRegistrationId, input.registrationId),
        inArray(
          registrationTransfers.status,
          activeRegistrationTransferStatuses,
        ),
      ),
      and(
        eq(registrationTransfers.recipientRegistrationId, input.registrationId),
        eq(registrationTransfers.status, 'checkout_pending'),
      ),
    ),
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
      id: registrationTransfers.id,
      recipientRegistrationId: registrationTransfers.recipientRegistrationId,
      sourceRegistrationId: registrationTransfers.sourceRegistrationId,
      status: registrationTransfers.status,
    })
    .from(registrationTransfers)
    .where(activeRegistrationTransferMutationPredicate(input))
    .for('update');
  const transfer = transferRows[0];
  if (!transfer || !isActiveRegistrationTransferStatus(transfer.status)) return;

  const registrationSide =
    transfer.sourceRegistrationId === input.registrationId
      ? 'source'
      : 'recipient';
  return yield* new RegistrationTransferMutationConflict({
    message:
      registrationSide === 'source'
        ? 'Cancel the active transfer offer before changing, cancelling, or checking in this registration.'
        : 'Use the transfer flow before changing or cancelling this recipient registration.',
    registrationId: input.registrationId,
    registrationSide,
    status: transfer.status,
    transferId: transfer.id,
  });
});
