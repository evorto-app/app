import { asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';
import * as Rpc from 'effect/unstable/rpc/Rpc';
import * as RpcGroup from 'effect/unstable/rpc/RpcGroup';

import { Tenant } from '../../../types/custom/tenant';
import { ForbiddenOrUnauthorizedRpcError } from '../../errors/rpc-errors';

export const GlobalAdminRpcError = ForbiddenOrUnauthorizedRpcError;

export type GlobalAdminRpcError = ForbiddenOrUnauthorizedRpcError;

export const GlobalAdminTenantRecord = Schema.Struct({
  currency: Tenant.fields.currency,
  domain: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  locale: Tenant.fields.locale,
  name: Schema.NonEmptyString,
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

export class GlobalAdminRpcs extends RpcGroup.make(
  GlobalAdminTenantsFindOne,
  GlobalAdminTenantsFindMany,
) {}
