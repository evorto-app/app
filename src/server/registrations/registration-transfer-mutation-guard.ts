import type { DatabaseClient } from '@db/index';

import { registrationTransfers } from '@db/schema';
import { activeRegistrationTransferStatuses } from '@shared/registration-transfer';
import { and, eq, inArray } from 'drizzle-orm';
import { Effect, Schema } from 'effect';

type RegistrationTransferGuardTransaction = Pick<DatabaseClient, 'select'>;

export const registrationTransferMutationBlockingStatuses = [
  'open',
  'checkout_pending',
] as const satisfies readonly (typeof activeRegistrationTransferStatuses)[number][];

export class RegistrationTransferMutationConflict extends Schema.TaggedErrorClass<RegistrationTransferMutationConflict>()(
  'RegistrationTransferMutationConflict',
  {
    message: Schema.String,
    registrationId: Schema.String,
    status: Schema.Literals(registrationTransferMutationBlockingStatuses),
    transferId: Schema.String,
  },
) {}

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
      status: registrationTransfers.status,
    })
    .from(registrationTransfers)
    .where(activeRegistrationTransferMutationPredicate(input))
    .for('update');
  const transfer = transferRows[0];
  if (
    !transfer ||
    (transfer.status !== 'open' && transfer.status !== 'checkout_pending')
  ) {
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
