import { Schema } from 'effect';

import {
  ForbiddenOrUnauthorizedRpcError,
  UnauthorizedRpcError,
} from '../../errors/rpc-errors';

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
