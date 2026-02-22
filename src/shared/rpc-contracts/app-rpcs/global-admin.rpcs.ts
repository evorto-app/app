import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

export const GlobalAdminRpcError = Schema.Literal('UNAUTHORIZED');

export type GlobalAdminRpcError = Schema.Schema.Type<
  typeof GlobalAdminRpcError
>;

export const GlobalAdminTenantRecord = Schema.Struct({
  domain: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
});

export type GlobalAdminTenantRecord = Schema.Schema.Type<
  typeof GlobalAdminTenantRecord
>;

export const GlobalAdminTenantsFindMany = asRpcQuery(
  Rpc.make('globalAdmin.tenants.findMany', {
    error: GlobalAdminRpcError,
    payload: Schema.Void,
    success: Schema.Array(GlobalAdminTenantRecord),
  }),
);

export class GlobalAdminRpcs extends RpcGroup.make(
  GlobalAdminTenantsFindMany,
) {}
