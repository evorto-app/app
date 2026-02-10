import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { Schema } from 'effect';

import { Tenant } from '../../types/custom/tenant';
import { PermissionSchema } from '../permissions/permissions';
import { iconSchema } from '../types/icon';

export const PublicConfig = Schema.Struct({
  googleMapsApiKey: Schema.NullOr(Schema.NonEmptyString),
  sentryDsn: Schema.NullOr(Schema.NonEmptyString),
});

export type PublicConfig = Schema.Schema.Type<typeof PublicConfig>;

export const ConfigPermissions = Schema.Array(PermissionSchema);

export type ConfigPermissions = Schema.Schema.Type<typeof ConfigPermissions>;

export const ConfigPublic = Rpc.make('config.public', {
  payload: Schema.Void,
  success: PublicConfig,
});

export const ConfigIsAuthenticated = Rpc.make('config.isAuthenticated', {
  payload: Schema.Void,
  success: Schema.Boolean,
});

export const ConfigPermissionList = Rpc.make('config.permissions', {
  payload: Schema.Void,
  success: ConfigPermissions,
});

export const ConfigTenant = Rpc.make('config.tenant', {
  payload: Schema.Void,
  success: Tenant,
});

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

export const IconsSearch = Rpc.make('icons.search', {
  error: IconRpcError,
  payload: Schema.Struct({ search: Schema.String }),
  success: Schema.Array(IconRecord),
});

export const IconsAdd = Rpc.make('icons.add', {
  error: IconRpcError,
  payload: Schema.Struct({ icon: Schema.NonEmptyString }),
  success: Schema.Array(IconRecord),
});

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

export const TemplateCategoriesFindMany = Rpc.make('templateCategories.findMany', {
  error: TemplateCategoryRpcError,
  payload: Schema.Void,
  success: Schema.Array(TemplateCategoryRecord),
});

export const TemplateCategoriesCreate = Rpc.make('templateCategories.create', {
  error: TemplateCategoryRpcError,
  payload: Schema.Struct({
    icon: iconSchema,
    title: Schema.NonEmptyString,
  }),
  success: Schema.Void,
});

export const TemplateCategoriesUpdate = Rpc.make('templateCategories.update', {
  error: TemplateCategoryRpcError,
  payload: Schema.Struct({
    icon: iconSchema,
    id: Schema.NonEmptyString,
    title: Schema.NonEmptyString,
  }),
  success: TemplateCategoryRecord,
});

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

export const TemplatesGroupedByCategory = Rpc.make(
  'templates.groupedByCategory',
  {
    error: TemplateCategoryRpcError,
    payload: Schema.Void,
    success: Schema.Array(TemplatesByCategoryRecord),
  },
);

export class AppRpcs extends RpcGroup.make(
  ConfigPublic,
  ConfigIsAuthenticated,
  ConfigPermissionList,
  ConfigTenant,
  IconsSearch,
  IconsAdd,
  TemplateCategoriesFindMany,
  TemplateCategoriesCreate,
  TemplateCategoriesUpdate,
  TemplatesGroupedByCategory,
) {}
