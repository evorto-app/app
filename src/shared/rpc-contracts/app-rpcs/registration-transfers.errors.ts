import { Schema } from 'effect';

export class RegistrationTransferConflictError extends Schema.TaggedError<RegistrationTransferConflictError>()(
  'RegistrationTransferConflictError',
  {
    message: Schema.String,
  },
) {}

export class RegistrationTransferInternalError extends Schema.TaggedError<RegistrationTransferInternalError>()(
  'RegistrationTransferInternalError',
  {
    message: Schema.String,
  },
) {}

export class RegistrationTransferNotFoundError extends Schema.TaggedError<RegistrationTransferNotFoundError>()(
  'RegistrationTransferNotFoundError',
  {
    message: Schema.String,
  },
) {}

export class RegistrationTransferUnauthorizedError extends Schema.TaggedError<RegistrationTransferUnauthorizedError>()(
  'RegistrationTransferUnauthorizedError',
  {
    message: Schema.String,
  },
) {}

export const RegistrationTransfersRpcError = Schema.Union([
  RegistrationTransferConflictError,
  RegistrationTransferInternalError,
  RegistrationTransferNotFoundError,
  RegistrationTransferUnauthorizedError,
]);

export type RegistrationTransfersRpcError = Schema.Schema.Type<
  typeof RegistrationTransfersRpcError
>;
