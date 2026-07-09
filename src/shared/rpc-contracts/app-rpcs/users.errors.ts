import { Schema } from 'effect';

import {
  ForbiddenOrUnauthorizedRpcError,
  RpcUnauthorizedError,
  UnauthorizedRpcError,
} from '../../errors/rpc-errors';

export class UserConflictError extends Schema.TaggedErrorClass<UserConflictError>()(
  'UserConflictError',
  {
    message: Schema.String,
  },
) {}

export class UserRoleAssignmentNotFoundError extends Schema.TaggedErrorClass<UserRoleAssignmentNotFoundError>()(
  'UserRoleAssignmentNotFoundError',
  {
    message: Schema.String,
  },
) {}

export class UserSelfRoleRemovalError extends Schema.TaggedErrorClass<UserSelfRoleRemovalError>()(
  'UserSelfRoleRemovalError',
  {
    message: Schema.String,
  },
) {}

export const UserRpcError = UnauthorizedRpcError;
export type UserRpcError = UnauthorizedRpcError;

export const UsersCreateAccountError = Schema.Union([
  UserConflictError,
  RpcUnauthorizedError,
]);
export type UsersCreateAccountError = Schema.Schema.Type<
  typeof UsersCreateAccountError
>;

export const UsersFindManyError = ForbiddenOrUnauthorizedRpcError;
export type UsersFindManyError = ForbiddenOrUnauthorizedRpcError;

export const UsersAssignRolesError = Schema.Union([
  ForbiddenOrUnauthorizedRpcError,
  UserRoleAssignmentNotFoundError,
  UserSelfRoleRemovalError,
]);
export type UsersAssignRolesError = Schema.Schema.Type<
  typeof UsersAssignRolesError
>;
