import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

import { Tenant } from '../../../types/custom/tenant';
import { PermissionSchema } from '../../permissions/permissions';
export const AdminRoleRpcError = Schema.Literal(
  'FORBIDDEN',
  'NOT_FOUND',
  'UNAUTHORIZED',
);

export type AdminRoleRpcError = Schema.Schema.Type<typeof AdminRoleRpcError>;

export const AdminRoleRecord = Schema.Struct({
  collapseMembersInHup: Schema.Boolean,
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  description: Schema.NullOr(Schema.String),
  displayInHub: Schema.Boolean,
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  permissions: Schema.mutable(Schema.Array(PermissionSchema)),
  showInHub: Schema.Boolean,
  sortOrder: Schema.Number,
});

export type AdminRoleRecord = Schema.Schema.Type<typeof AdminRoleRecord>;

export const AdminRolesFindManyInput = Schema.Struct({
  defaultOrganizerRole: Schema.optional(Schema.Boolean),
  defaultUserRole: Schema.optional(Schema.Boolean),
});

export type AdminRolesFindManyInput = Schema.Schema.Type<
  typeof AdminRolesFindManyInput
>;

export const AdminRolesFindMany = asRpcQuery(
  Rpc.make('admin.roles.findMany', {
    error: AdminRoleRpcError,
    payload: AdminRolesFindManyInput,
    success: Schema.Array(AdminRoleRecord),
  }),
);

export const AdminRolesFindOne = asRpcQuery(
  Rpc.make('admin.roles.findOne', {
    error: AdminRoleRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: AdminRoleRecord,
  }),
);

export const AdminHubRoleUserRecord = Schema.Struct({
  firstName: Schema.String,
  id: Schema.NonEmptyString,
  lastName: Schema.String,
});

export type AdminHubRoleUserRecord = Schema.Schema.Type<
  typeof AdminHubRoleUserRecord
>;

export const AdminHubRoleRecord = Schema.Struct({
  description: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  name: Schema.String,
  userCount: Schema.Number,
  users: Schema.Array(AdminHubRoleUserRecord),
});

export type AdminHubRoleRecord = Schema.Schema.Type<typeof AdminHubRoleRecord>;

export const AdminRolesFindHubRoles = asRpcQuery(
  Rpc.make('admin.roles.findHubRoles', {
    error: AdminRoleRpcError,
    payload: Schema.Void,
    success: Schema.Array(AdminHubRoleRecord),
  }),
);

export const AdminRolesCreateInput = Schema.Struct({
  defaultOrganizerRole: Schema.Boolean,
  defaultUserRole: Schema.Boolean,
  description: Schema.NullOr(Schema.NonEmptyString),
  name: Schema.NonEmptyString,
  permissions: Schema.mutable(Schema.Array(PermissionSchema)),
});

export type AdminRolesCreateInput = Schema.Schema.Type<
  typeof AdminRolesCreateInput
>;

export const AdminRolesCreate = asRpcMutation(
  Rpc.make('admin.roles.create', {
    error: AdminRoleRpcError,
    payload: AdminRolesCreateInput,
    success: AdminRoleRecord,
  }),
);

export const AdminRolesDelete = asRpcMutation(
  Rpc.make('admin.roles.delete', {
    error: AdminRoleRpcError,
    payload: Schema.Struct({
      id: Schema.NonEmptyString,
    }),
    success: Schema.Void,
  }),
);

export const AdminRolesSearch = asRpcQuery(
  Rpc.make('admin.roles.search', {
    error: AdminRoleRpcError,
    payload: Schema.Struct({
      search: Schema.String,
    }),
    success: Schema.Array(AdminRoleRecord),
  }),
);

export const AdminRolesUpdate = asRpcMutation(
  Rpc.make('admin.roles.update', {
    error: AdminRoleRpcError,
    payload: Schema.Struct({
      defaultOrganizerRole: Schema.Boolean,
      defaultUserRole: Schema.Boolean,
      description: Schema.NullOr(Schema.NonEmptyString),
      id: Schema.NonEmptyString,
      name: Schema.NonEmptyString,
      permissions: Schema.mutable(Schema.Array(PermissionSchema)),
    }),
    success: AdminRoleRecord,
  }),
);

export const AdminTenantRpcError = Schema.Literal(
  'BAD_REQUEST',
  'FORBIDDEN',
  'UNAUTHORIZED',
);

export type AdminTenantRpcError = Schema.Schema.Type<
  typeof AdminTenantRpcError
>;

export const AdminTenantTaxRateRecord = Schema.Struct({
  active: Schema.Boolean,
  country: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  inclusive: Schema.Boolean,
  percentage: Schema.NullOr(Schema.String),
  state: Schema.NullOr(Schema.String),
  stripeTaxRateId: Schema.NonEmptyString,
});

export type AdminTenantTaxRateRecord = Schema.Schema.Type<
  typeof AdminTenantTaxRateRecord
>;

export const AdminTenantStripeTaxRateRecord = Schema.Struct({
  active: Schema.Boolean,
  country: Schema.NullOr(Schema.String),
  displayName: Schema.NullOr(Schema.String),
  id: Schema.NonEmptyString,
  inclusive: Schema.Boolean,
  percentage: Schema.NullOr(Schema.Number),
  state: Schema.NullOr(Schema.String),
});

export type AdminTenantStripeTaxRateRecord = Schema.Schema.Type<
  typeof AdminTenantStripeTaxRateRecord
>;

export const AdminTenantImportStripeTaxRates = asRpcMutation(
  Rpc.make('admin.tenant.importStripeTaxRates', {
    error: AdminTenantRpcError,
    payload: Schema.Struct({
      ids: Schema.Array(Schema.NonEmptyString),
    }),
    success: Schema.Void,
  }),
);

export const AdminTenantListImportedTaxRates = asRpcQuery(
  Rpc.make('admin.tenant.listImportedTaxRates', {
    error: AdminTenantRpcError,
    payload: Schema.Void,
    success: Schema.Array(AdminTenantTaxRateRecord),
  }),
);

export const AdminTenantListStripeTaxRates = asRpcQuery(
  Rpc.make('admin.tenant.listStripeTaxRates', {
    error: AdminTenantRpcError,
    payload: Schema.Void,
    success: Schema.Array(AdminTenantStripeTaxRateRecord),
  }),
);

export const AdminTenantUpdateSettings = asRpcMutation(
  Rpc.make('admin.tenant.updateSettings', {
    error: AdminTenantRpcError,
    payload: Schema.Struct({
      allowOther: Schema.Boolean,
      buyEsnCardUrl: Schema.optional(Schema.String),
      defaultLocation: Schema.NullOr(Schema.Any),
      esnCardEnabled: Schema.Boolean,
      receiptCountries: Schema.Array(Schema.NonEmptyString),
      theme: Schema.mutable(Schema.Literal('evorto', 'esn')),
    }),
    success: Tenant,
  }),
);

export class AdminRpcs extends RpcGroup.make(
  AdminRolesCreate,
  AdminRolesDelete,
  AdminRolesFindHubRoles,
  AdminRolesFindMany,
  AdminRolesFindOne,
  AdminRolesSearch,
  AdminRolesUpdate,
  AdminTenantImportStripeTaxRates,
  AdminTenantListImportedTaxRates,
  AdminTenantListStripeTaxRates,
  AdminTenantUpdateSettings,
) {}
