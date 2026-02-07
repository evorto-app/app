import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { Schema } from 'effect';

import { PermissionSchema } from '../permissions/permissions';

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

export class AppRpcs extends RpcGroup.make(
  ConfigPublic,
  ConfigIsAuthenticated,
  ConfigPermissionList,
) {}
