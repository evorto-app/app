import { Schema } from 'effect';

import {
  ForbiddenOrUnauthorizedRpcError,
  RpcUnauthorizedError,
  UnauthorizedRpcError,
} from '../../errors/rpc-errors';

export class UserConflictError extends Schema.TaggedError<UserConflictError>()(
  'UserConflictError',
  {
    message: Schema.String,
  },
) {}

export const UserRpcError = UnauthorizedRpcError;
export type UserRpcError = UnauthorizedRpcError;

export const UsersCreateAccountError = Schema.Union(
  UserConflictError,
  RpcUnauthorizedError,
);
export type UsersCreateAccountError = Schema.Schema.Type<
  typeof UsersCreateAccountError
>;

export const UsersFindManyError = ForbiddenOrUnauthorizedRpcError;
export type UsersFindManyError = ForbiddenOrUnauthorizedRpcError;
