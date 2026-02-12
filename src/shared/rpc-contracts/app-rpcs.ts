import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

import { Tenant } from '../../types/custom/tenant';
import { User } from '../../types/custom/user';
import { PermissionSchema } from '../permissions/permissions';
import { iconSchema } from '../types/icon';

export const PublicConfig = Schema.Struct({
  googleMapsApiKey: Schema.NullOr(Schema.NonEmptyString),
  sentryDsn: Schema.NullOr(Schema.NonEmptyString),
});

export type PublicConfig = Schema.Schema.Type<typeof PublicConfig>;

export const ConfigPermissions = Schema.Array(PermissionSchema);

export type ConfigPermissions = Schema.Schema.Type<typeof ConfigPermissions>;

export const ConfigPublic = asRpcQuery(
  Rpc.make('config.public', {
    payload: Schema.Void,
    success: PublicConfig,
  }),
);

export const ConfigIsAuthenticated = asRpcQuery(
  Rpc.make('config.isAuthenticated', {
    payload: Schema.Void,
    success: Schema.Boolean,
  }),
);

export const ConfigPermissionList = asRpcQuery(
  Rpc.make('config.permissions', {
    payload: Schema.Void,
    success: ConfigPermissions,
  }),
);

export const ConfigTenant = asRpcQuery(
  Rpc.make('config.tenant', {
    payload: Schema.Void,
    success: Tenant,
  }),
);

export const UsersUserAssigned = asRpcQuery(
  Rpc.make('users.userAssigned', {
    payload: Schema.Void,
    success: Schema.Boolean,
  }),
);

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

export type UsersFindManyRecord = Schema.Schema.Type<typeof UsersFindManyRecord>;

export const UsersFindManyResult = Schema.Struct({
  users: Schema.Array(UsersFindManyRecord),
  usersCount: Schema.Number,
});

export type UsersFindManyResult = Schema.Schema.Type<typeof UsersFindManyResult>;

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

export const IconRpcError = Schema.Literal(
  'INVALID_ICON_NAME',
  'UNAUTHORIZED',
);

export type IconRpcError = Schema.Schema.Type<typeof IconRpcError>;

export const IconRecord = Schema.Struct({
  commonName: Schema.NonEmptyString,
  friendlyName: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  sourceColor: Schema.NullOr(Schema.Number),
});

export type IconRecord = Schema.Schema.Type<typeof IconRecord>;

export const IconsSearch = asRpcQuery(
  Rpc.make('icons.search', {
    error: IconRpcError,
    payload: Schema.Struct({ search: Schema.String }),
    success: Schema.Array(IconRecord),
  }),
);

export const IconsAdd = asRpcMutation(
  Rpc.make('icons.add', {
    error: IconRpcError,
    payload: Schema.Struct({ icon: Schema.NonEmptyString }),
    success: Schema.Array(IconRecord),
  }),
);

export const TemplateCategoryRpcError = Schema.Literal(
  'FORBIDDEN',
  'UNAUTHORIZED',
);

export type TemplateCategoryRpcError = Schema.Schema.Type<
  typeof TemplateCategoryRpcError
>;

export const TemplateCategoryRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export type TemplateCategoryRecord = Schema.Schema.Type<
  typeof TemplateCategoryRecord
>;

export const TemplateCategoriesFindMany = asRpcQuery(
  Rpc.make('templateCategories.findMany', {
    error: TemplateCategoryRpcError,
    payload: Schema.Void,
    success: Schema.Array(TemplateCategoryRecord),
  }),
);

export const TemplateCategoriesCreate = asRpcMutation(
  Rpc.make('templateCategories.create', {
    error: TemplateCategoryRpcError,
    payload: Schema.Struct({
      icon: iconSchema,
      title: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const TemplateCategoriesUpdate = asRpcMutation(
  Rpc.make('templateCategories.update', {
    error: TemplateCategoryRpcError,
    payload: Schema.Struct({
      icon: iconSchema,
      id: Schema.NonEmptyString,
      title: Schema.NonEmptyString,
    }),
    success: TemplateCategoryRecord,
  }),
);

export const TemplateListRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
});

export type TemplateListRecord = Schema.Schema.Type<typeof TemplateListRecord>;

export const TemplatesByCategoryRecord = Schema.Struct({
  icon: iconSchema,
  id: Schema.NonEmptyString,
  templates: Schema.Array(TemplateListRecord),
  title: Schema.NonEmptyString,
});

export type TemplatesByCategoryRecord = Schema.Schema.Type<
  typeof TemplatesByCategoryRecord
>;

export const TemplatesGroupedByCategory = asRpcQuery(
  Rpc.make('templates.groupedByCategory', {
    error: TemplateCategoryRpcError,
    payload: Schema.Void,
    success: Schema.Array(TemplatesByCategoryRecord),
  }),
);

export class AppRpcs extends RpcGroup.make(
  ConfigPublic,
  ConfigIsAuthenticated,
  ConfigPermissionList,
  ConfigTenant,
  UsersAuthDataFind,
  UsersCreateAccount,
  UsersFindMany,
  UsersEventsFindMany,
  UsersMaybeSelf,
  UsersSelf,
  UsersUpdateProfile,
  UsersUserAssigned,
  IconsSearch,
  IconsAdd,
  TemplateCategoriesFindMany,
  TemplateCategoriesCreate,
  TemplateCategoriesUpdate,
  TemplatesGroupedByCategory,
) {}
