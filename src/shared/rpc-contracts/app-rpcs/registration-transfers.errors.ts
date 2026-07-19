import { Schema } from 'effect';

export class RegistrationTransferConflictError extends Schema.TaggedErrorClass<RegistrationTransferConflictError>()(
  'RegistrationTransferConflictError',
  {
    message: Schema.String,
  },
) {}

export class RegistrationTransferInternalError extends Schema.TaggedErrorClass<RegistrationTransferInternalError>()(
  'RegistrationTransferInternalError',
  {
    cause: Schema.optional(Schema.Defect()),
    message: Schema.String,
  },
) {}

export class RegistrationTransferNotFoundError extends Schema.TaggedErrorClass<RegistrationTransferNotFoundError>()(
  'RegistrationTransferNotFoundError',
  {
    message: Schema.String,
  },
) {}

export class RegistrationTransferUnauthorizedError extends Schema.TaggedErrorClass<RegistrationTransferUnauthorizedError>()(
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
