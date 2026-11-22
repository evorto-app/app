import { Schema } from 'effect';

import {
  BadRequestOrUnauthorizedRpcError,
  ForbiddenOrUnauthorizedRpcError,
  RpcUnauthorizedError,
} from '../../errors/rpc-errors';

export class UserRoleAssignmentNotFoundError extends Schema.TaggedError<UserRoleAssignmentNotFoundError>()(
  'UserRoleAssignmentNotFoundError',
  {
    message: Schema.String,
  },
) {}

export class UserSelfRoleRemovalError extends Schema.TaggedError<UserSelfRoleRemovalError>()(
  'UserSelfRoleRemovalError',
  {
    message: Schema.String,
  },
) {}

export const UserRpcError = RpcUnauthorizedError;
export type UserRpcError = RpcUnauthorizedError;

export const UsersFindManyError = ForbiddenOrUnauthorizedRpcError;
export type UsersFindManyError = ForbiddenOrUnauthorizedRpcError;

export const UsersUpdateProfileError = BadRequestOrUnauthorizedRpcError;
export type UsersUpdateProfileError = BadRequestOrUnauthorizedRpcError;

export const UsersAssignRolesError = Schema.Union([
  ForbiddenOrUnauthorizedRpcError,
  UserRoleAssignmentNotFoundError,
  UserSelfRoleRemovalError,
]);
export type UsersAssignRolesError = Schema.Schema.Type<
  typeof UsersAssignRolesError
>;
