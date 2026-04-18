import { Schema } from 'effect';

export class RpcBadRequestError extends Schema.TaggedError<RpcBadRequestError>()(
  'RpcBadRequestError',
  {
    message: Schema.String,
    reason: Schema.optional(Schema.String),
  },
) {}

export class RpcForbiddenError extends Schema.TaggedError<RpcForbiddenError>()(
  'RpcForbiddenError',
  {
    message: Schema.String,
    permission: Schema.optional(Schema.String),
  },
) {}

export class RpcInternalServerError extends Schema.TaggedError<RpcInternalServerError>()(
  'RpcInternalServerError',
  {
    cause: Schema.optional(Schema.Defect),
    message: Schema.String,
  },
) {}

export class RpcUnauthorizedError extends Schema.TaggedError<RpcUnauthorizedError>()(
  'RpcUnauthorizedError',
  {
    message: Schema.String,
  },
) {}

export const UnauthorizedRpcError = RpcUnauthorizedError;
export type UnauthorizedRpcError = Schema.Schema.Type<typeof UnauthorizedRpcError>;

export const ForbiddenRpcError = RpcForbiddenError;
export type ForbiddenRpcError = Schema.Schema.Type<typeof ForbiddenRpcError>;

export const BadRequestRpcError = RpcBadRequestError;
export type BadRequestRpcError = Schema.Schema.Type<typeof BadRequestRpcError>;

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

export const BadRequestInternalUnauthorizedRpcError = Schema.Union(
  RpcBadRequestError,
  RpcInternalServerError,
  RpcUnauthorizedError,
);
export type BadRequestInternalUnauthorizedRpcError = Schema.Schema.Type<
  typeof BadRequestInternalUnauthorizedRpcError
>;

export const BadRequestForbiddenInternalUnauthorizedRpcError = Schema.Union(
  RpcBadRequestError,
  RpcForbiddenError,
  RpcInternalServerError,
  RpcUnauthorizedError,
);
export type BadRequestForbiddenInternalUnauthorizedRpcError = Schema.Schema.Type<
  typeof BadRequestForbiddenInternalUnauthorizedRpcError
>;
