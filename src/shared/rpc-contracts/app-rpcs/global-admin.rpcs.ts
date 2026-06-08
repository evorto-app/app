import { asRpcMutation, asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { Tenant } from '../../../types/custom/tenant';
import { BadRequestForbiddenOrUnauthorizedRpcError } from '../../errors/rpc-errors';

export const GlobalAdminRpcError = BadRequestForbiddenOrUnauthorizedRpcError;

export type GlobalAdminRpcError = BadRequestForbiddenOrUnauthorizedRpcError;

export const GlobalAdminTenantRecord = Schema.Struct({
  currency: Tenant.fields.currency,
  domain: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  locale: Tenant.fields.locale,
  name: Schema.NonEmptyString,
  stripeAccountId: Schema.NullOr(Schema.String),
  stripeConnected: Schema.Boolean,
  theme: Tenant.fields.theme,
  timezone: Tenant.fields.timezone,
});

export type GlobalAdminTenantRecord = Schema.Schema.Type<
  typeof GlobalAdminTenantRecord
>;

export const GlobalAdminTenantIdInput = Schema.Struct({
  id: Schema.NonEmptyString,
});

export const GlobalAdminTenantWriteInput = Schema.Struct({
  currency: Tenant.fields.currency,
  domain: Schema.NonEmptyString,
  locale: Tenant.fields.locale,
  name: Schema.NonEmptyString,
  stripeAccountId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
  theme: Tenant.fields.theme,
  timezone: Tenant.fields.timezone,
});

export type GlobalAdminTenantWriteInput = Schema.Schema.Type<
  typeof GlobalAdminTenantWriteInput
>;

export const GlobalAdminTenantsFindMany = asRpcQuery(
  Rpc.make('globalAdmin.tenants.findMany', {
    error: GlobalAdminRpcError,
    payload: Schema.Void,
    success: Schema.Array(GlobalAdminTenantRecord),
  }),
);

export const GlobalAdminTenantsFindOne = asRpcQuery(
  Rpc.make('globalAdmin.tenants.findOne', {
    error: GlobalAdminRpcError,
    payload: GlobalAdminTenantIdInput,
    success: Schema.NullOr(GlobalAdminTenantRecord),
  }),
);

export const GlobalAdminTenantsCreate = asRpcMutation(
  Rpc.make('globalAdmin.tenants.create', {
    error: GlobalAdminRpcError,
    payload: GlobalAdminTenantWriteInput,
    success: GlobalAdminTenantRecord,
  }),
);

export const GlobalAdminTenantsUpdate = asRpcMutation(
  Rpc.make('globalAdmin.tenants.update', {
    error: GlobalAdminRpcError,
    payload: Schema.Struct({
      currency: Tenant.fields.currency,
      domain: Schema.NonEmptyString,
      id: Schema.NonEmptyString,
      locale: Tenant.fields.locale,
      name: Schema.NonEmptyString,
      stripeAccountId: Schema.optional(Schema.NullOr(Schema.NonEmptyString)),
      theme: Tenant.fields.theme,
      timezone: Tenant.fields.timezone,
    }),
    success: GlobalAdminTenantRecord,
  }),
);

export class GlobalAdminRpcs extends RpcGroup.make(
  GlobalAdminTenantsCreate,
  GlobalAdminTenantsFindOne,
  GlobalAdminTenantsFindMany,
  GlobalAdminTenantsUpdate,
) {}
