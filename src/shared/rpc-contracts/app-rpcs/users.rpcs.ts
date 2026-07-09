import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { notificationEmailPattern } from '@shared/notification-email';
import { literalUnion } from '@shared/schema-utilities';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { User } from '../../../types/custom/user';
import {
  UserRpcError,
  UsersAssignRolesError,
  UsersCreateAccountError,
  UsersFindManyError,
} from './users.errors';

const NotificationEmail = Schema.NonEmptyString.check(
  Schema.isPattern(notificationEmailPattern),
);

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

export const UsersCanUseScanner = asRpcQuery(
  Rpc.make('users.canUseScanner', {
    payload: Schema.Void,
    success: Schema.Boolean,
  }),
);

export const UsersCreateAccountInput = Schema.Struct({
  communicationEmail: NotificationEmail,
  firstName: Schema.NonEmptyString,
  lastName: Schema.NonEmptyString,
});

export type UsersCreateAccountInput = Schema.Schema.Type<
  typeof UsersCreateAccountInput
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
  roleIds: Schema.Array(Schema.NonEmptyString),
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

export const UsersFindMany = asRpcQuery(
  Rpc.make('users.findMany', {
    error: UsersFindManyError,
    payload: UsersFindManyInput,
    success: UsersFindManyResult,
  }),
);

export const UsersAssignRoles = asRpcMutation(
  Rpc.make('users.assignRoles', {
    error: UsersAssignRolesError,
    payload: Schema.Struct({
      roleIds: Schema.Array(Schema.NonEmptyString),
      userId: Schema.NonEmptyString,
    }),
    success: Schema.Void,
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
  communicationEmail: NotificationEmail,
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
  addonPurchases: Schema.Array(
    Schema.Struct({
      quantity: Schema.Number,
      title: Schema.NonEmptyString,
      unitPrice: Schema.Number,
    }),
  ),
  checkInTime: Schema.NullOr(Schema.String),
  checkoutUrl: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  end: Schema.String,
  eventId: Schema.NonEmptyString,
  guestCount: Schema.Number,
  paymentState: literalUnion('cancelled', 'notRequired', 'pending', 'recorded'),
  registrationId: Schema.NonEmptyString,
  registrationOptionTitle: Schema.NonEmptyString,
  start: Schema.String,
  status: literalUnion('CONFIRMED', 'PENDING', 'WAITLIST'),
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
  UsersAssignRoles,
  UsersAuthDataFind,
  UsersCanUseScanner,
  UsersCreateAccount,
  UsersFindMany,
  UsersEventsFindMany,
  UsersMaybeSelf,
  UsersSelf,
  UsersUpdateProfile,
  UsersUserAssigned,
) {}
