import { Schema } from 'effect';

export type EventRegistrationError =
  | EventRegistrationConflictError
  | EventRegistrationInternalError
  | EventRegistrationNotFoundError;

export type ReceiptMediaError =
  | ReceiptMediaBadRequestError
  | ReceiptMediaInternalError
  | ReceiptMediaServiceUnavailableError;

export type TemplateSimpleError =
  | TemplateSimpleBadRequestError
  | TemplateSimpleInternalError
  | TemplateSimpleNotFoundError;

export class EventRegistrationConflictError extends new Schema.TaggedError<EventRegistrationConflictError>()(
  'EventRegistrationConflictError',
  {
    message: Schema.String,
  },
) {}

export class EventRegistrationInternalError extends new Schema.TaggedError<EventRegistrationInternalError>()(
  'EventRegistrationInternalError',
  {
    message: Schema.String,
  },
) {}

export class EventRegistrationNotFoundError extends new Schema.TaggedError<EventRegistrationNotFoundError>()(
  'EventRegistrationNotFoundError',
  {
    message: Schema.String,
  },
) {}

export class InvalidIconNameError extends new Schema.TaggedError<InvalidIconNameError>()(
  'InvalidIconNameError',
  {
    iconName: Schema.String,
    message: Schema.String,
  },
) {}

export class ReceiptMediaBadRequestError extends new Schema.TaggedError<ReceiptMediaBadRequestError>()(
  'ReceiptMediaBadRequestError',
  {
    message: Schema.String,
  },
) {}

export class ReceiptMediaInternalError extends new Schema.TaggedError<ReceiptMediaInternalError>()(
  'ReceiptMediaInternalError',
  {
    cause: Schema.optional(Schema.Defect),
    message: Schema.String,
  },
) {}

export class ReceiptMediaServiceUnavailableError extends new Schema.TaggedError<ReceiptMediaServiceUnavailableError>()(
  'ReceiptMediaServiceUnavailableError',
  {
    cause: Schema.optional(Schema.Defect),
    message: Schema.String,
  },
) {}

export class RpcBadRequestError extends new Schema.TaggedError<RpcBadRequestError>()(
  'RpcBadRequestError',
  {
    message: Schema.String,
    reason: Schema.optional(Schema.String),
  },
) {}

export class RpcConflictError extends new Schema.TaggedError<RpcConflictError>()(
  'RpcConflictError',
  {
    message: Schema.String,
    resource: Schema.optional(Schema.String),
  },
) {}

export class RpcForbiddenError extends new Schema.TaggedError<RpcForbiddenError>()(
  'RpcForbiddenError',
  {
    message: Schema.String,
    permission: Schema.optional(Schema.String),
  },
) {}

export class RpcInternalServerError extends new Schema.TaggedError<RpcInternalServerError>()(
  'RpcInternalServerError',
  {
    cause: Schema.optional(Schema.Defect),
    message: Schema.String,
  },
) {}

export class RpcNotFoundError extends new Schema.TaggedError<RpcNotFoundError>()(
  'RpcNotFoundError',
  {
    id: Schema.optional(Schema.String),
    message: Schema.String,
    resource: Schema.optional(Schema.String),
  },
) {}

export class RpcUnauthorizedError extends new Schema.TaggedError<RpcUnauthorizedError>()(
  'RpcUnauthorizedError',
  {
    message: Schema.String,
  },
) {}

export class TemplateSimpleBadRequestError extends new Schema.TaggedError<TemplateSimpleBadRequestError>()(
  'TemplateSimpleBadRequestError',
  {
    message: Schema.String,
  },
) {}

export class TemplateSimpleInternalError extends new Schema.TaggedError<TemplateSimpleInternalError>()(
  'TemplateSimpleInternalError',
  {
    message: Schema.String,
  },
) {}

export class TemplateSimpleNotFoundError extends new Schema.TaggedError<TemplateSimpleNotFoundError>()(
  'TemplateSimpleNotFoundError',
  {
    message: Schema.String,
  },
) {}

export const UnauthorizedRpcError = RpcUnauthorizedError;
export type UnauthorizedRpcError = Schema.Schema.Type<typeof UnauthorizedRpcError>;

export const ForbiddenOrUnauthorizedRpcError = Schema.Union(
  RpcForbiddenError,
  RpcUnauthorizedError,
);
export type ForbiddenOrUnauthorizedRpcError = Schema.Schema.Type<
  typeof ForbiddenOrUnauthorizedRpcError
>;

export const BadRequestOrUnauthorizedRpcError = Schema.Union(
  RpcBadRequestError,
  RpcUnauthorizedError,
);
export type BadRequestOrUnauthorizedRpcError = Schema.Schema.Type<
  typeof BadRequestOrUnauthorizedRpcError
>;

export const BadRequestForbiddenOrUnauthorizedRpcError = Schema.Union(
  RpcBadRequestError,
  RpcForbiddenError,
  RpcUnauthorizedError,
);
export type BadRequestForbiddenOrUnauthorizedRpcError = Schema.Schema.Type<
  typeof BadRequestForbiddenOrUnauthorizedRpcError
>;

export const ConflictOrUnauthorizedRpcError = Schema.Union(
  RpcConflictError,
  RpcUnauthorizedError,
);
export type ConflictOrUnauthorizedRpcError = Schema.Schema.Type<
  typeof ConflictOrUnauthorizedRpcError
>;

export const ConflictForbiddenNotFoundUnauthorizedRpcError = Schema.Union(
  RpcConflictError,
  RpcForbiddenError,
  RpcNotFoundError,
  RpcUnauthorizedError,
);
export type ConflictForbiddenNotFoundUnauthorizedRpcError = Schema.Schema.Type<
  typeof ConflictForbiddenNotFoundUnauthorizedRpcError
>;

export const ConflictInternalNotFoundUnauthorizedRpcError = Schema.Union(
  RpcConflictError,
  RpcInternalServerError,
  RpcNotFoundError,
  RpcUnauthorizedError,
);
export type ConflictInternalNotFoundUnauthorizedRpcError = Schema.Schema.Type<
  typeof ConflictInternalNotFoundUnauthorizedRpcError
>;

export const BadRequestConflictForbiddenInternalNotFoundUnauthorizedRpcError =
  Schema.Union(
    RpcBadRequestError,
    RpcConflictError,
    RpcForbiddenError,
    RpcInternalServerError,
    RpcNotFoundError,
    RpcUnauthorizedError,
  );
export type BadRequestConflictForbiddenInternalNotFoundUnauthorizedRpcError =
  Schema.Schema.Type<
    typeof BadRequestConflictForbiddenInternalNotFoundUnauthorizedRpcError
  >;

export const BadRequestForbiddenInternalNotFoundUnauthorizedRpcError =
  Schema.Union(
    RpcBadRequestError,
    RpcForbiddenError,
    RpcInternalServerError,
    RpcNotFoundError,
    RpcUnauthorizedError,
  );
export type BadRequestForbiddenInternalNotFoundUnauthorizedRpcError =
  Schema.Schema.Type<
    typeof BadRequestForbiddenInternalNotFoundUnauthorizedRpcError
  >;

export const BadRequestForbiddenInternalUnauthorizedRpcError = Schema.Union(
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
);
export type BadRequestForbiddenInternalUnauthorizedRpcError =
  Schema.Schema.Type<typeof BadRequestForbiddenInternalUnauthorizedRpcError>;

export const BadRequestInternalUnauthorizedRpcError = Schema.Union(
  RpcBadRequestError,
  RpcInternalServerError,
  RpcUnauthorizedError,
);
export type BadRequestInternalUnauthorizedRpcError = Schema.Schema.Type<
  typeof BadRequestInternalUnauthorizedRpcError
>;

export const InternalNotFoundUnauthorizedRpcError = Schema.Union(
  RpcInternalServerError,
  RpcNotFoundError,
  RpcUnauthorizedError,
);
export type InternalNotFoundUnauthorizedRpcError = Schema.Schema.Type<
  typeof InternalNotFoundUnauthorizedRpcError
>;

export const ForbiddenNotFoundUnauthorizedRpcError = Schema.Union(
  RpcForbiddenError,
  RpcNotFoundError,
  RpcUnauthorizedError,
);
export type ForbiddenNotFoundUnauthorizedRpcError = Schema.Schema.Type<
  typeof ForbiddenNotFoundUnauthorizedRpcError
>;

export const ForbiddenRpcError = RpcForbiddenError;
export type ForbiddenRpcError = Schema.Schema.Type<typeof ForbiddenRpcError>;

export const BadRequestRpcError = RpcBadRequestError;
export type BadRequestRpcError = Schema.Schema.Type<typeof BadRequestRpcError>;

export const InvalidIconOrUnauthorizedRpcError = Schema.Union(
  InvalidIconNameError,
  RpcUnauthorizedError,
);
export type InvalidIconOrUnauthorizedRpcError = Schema.Schema.Type<
  typeof InvalidIconOrUnauthorizedRpcError
>;
