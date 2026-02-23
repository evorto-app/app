import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

import { User } from '../../../types/custom/user';
export const UserRpcError = Schema.Literal('UNAUTHORIZED');

export type UserRpcError = Schema.Schema.Type<typeof UserRpcError>;

export const UsersAuthData = Schema.Struct({
  email: Schema.optional(Schema.NullOr(Schema.String)),
  email_verified: Schema.optional(Schema.NullOr(Schema.Boolean)),
  family_name: Schema.optional(Schema.NullOr(Schema.String)),
  given_name: Schema.optional(Schema.NullOr(Schema.String)),
  sub: Schema.optional(Schema.NullOr(Schema.String)),
});

export type UsersAuthData = Schema.Schema.Type<typeof UsersAuthData>;

export const UsersAuthDataFind = asRpcQuery(
  Rpc.make('users.authData', {
    payload: Schema.Void,
    success: UsersAuthData,
  }),
);

export const UsersCreateAccountInput = Schema.Struct({
  communicationEmail: Schema.NonEmptyString,
  firstName: Schema.NonEmptyString,
  lastName: Schema.NonEmptyString,
});

export type UsersCreateAccountInput = Schema.Schema.Type<
  typeof UsersCreateAccountInput
>;

export const UsersCreateAccountError = Schema.Literal(
  'CONFLICT',
  'UNAUTHORIZED',
);

export type UsersCreateAccountError = Schema.Schema.Type<
  typeof UsersCreateAccountError
>;

export const UsersCreateAccount = asRpcMutation(
  Rpc.make('users.createAccount', {
    error: UsersCreateAccountError,
    payload: UsersCreateAccountInput,
    success: Schema.Void,
  }),
);

export const UsersFindManyInput = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  search: Schema.optional(Schema.NonEmptyString),
});

export type UsersFindManyInput = Schema.Schema.Type<typeof UsersFindManyInput>;

export const UsersFindManyRecord = Schema.Struct({
  email: Schema.String,
  firstName: Schema.String,
  id: Schema.NonEmptyString,
  lastName: Schema.String,
  roles: Schema.Array(Schema.String),
});

export type UsersFindManyRecord = Schema.Schema.Type<
  typeof UsersFindManyRecord
>;

export const UsersFindManyResult = Schema.Struct({
  users: Schema.Array(UsersFindManyRecord),
  usersCount: Schema.Number,
});

export type UsersFindManyResult = Schema.Schema.Type<
  typeof UsersFindManyResult
>;

export const UsersFindManyError = Schema.Literal('FORBIDDEN', 'UNAUTHORIZED');

export type UsersFindManyError = Schema.Schema.Type<typeof UsersFindManyError>;

export const UsersFindMany = asRpcQuery(
  Rpc.make('users.findMany', {
    error: UsersFindManyError,
    payload: UsersFindManyInput,
    success: UsersFindManyResult,
  }),
);

export const UsersMaybeSelf = asRpcQuery(
  Rpc.make('users.maybeSelf', {
    payload: Schema.Void,
    success: Schema.NullOr(User),
  }),
);

export const UsersSelf = asRpcQuery(
  Rpc.make('users.self', {
    error: UserRpcError,
    payload: Schema.Void,
    success: User,
  }),
);

export const UsersUpdateProfileInput = Schema.Struct({
  firstName: Schema.NonEmptyString,
  iban: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  lastName: Schema.NonEmptyString,
  paypalEmail: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
});

export type UsersUpdateProfileInput = Schema.Schema.Type<
  typeof UsersUpdateProfileInput
>;

export const UsersUpdateProfile = asRpcMutation(
  Rpc.make('users.updateProfile', {
    error: UserRpcError,
    payload: UsersUpdateProfileInput,
    success: Schema.Void,
  }),
);

export const UsersEventSummaryRecord = Schema.Struct({
  description: Schema.NullOr(Schema.String),
  end: Schema.String,
  id: Schema.NonEmptyString,
  start: Schema.String,
  title: Schema.NonEmptyString,
});

export type UsersEventSummaryRecord = Schema.Schema.Type<
  typeof UsersEventSummaryRecord
>;

export const UsersEventsFindMany = asRpcQuery(
  Rpc.make('users.events', {
    error: UserRpcError,
    payload: Schema.Void,
    success: Schema.Array(UsersEventSummaryRecord),
  }),
);

export const UsersUserAssigned = asRpcQuery(
  Rpc.make('users.userAssigned', {
    payload: Schema.Void,
    success: Schema.Boolean,
  }),
);

export class UsersRpcs extends RpcGroup.make(
  UsersAuthDataFind,
  UsersCreateAccount,
  UsersFindMany,
  UsersEventsFindMany,
  UsersMaybeSelf,
  UsersSelf,
  UsersUpdateProfile,
  UsersUserAssigned,
) {}
