import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { asRpcQuery } from '@heddendorp/effect-angular-query';
import { Schema } from 'effect';

import { Tenant } from '../../../types/custom/tenant';
import { PermissionSchema } from '../../permissions/permissions';
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

export class ConfigRpcs extends RpcGroup.make(
  ConfigPublic,
  ConfigIsAuthenticated,
  ConfigPermissionList,
  ConfigTenant,
) {}
