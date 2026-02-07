import * as Rpc from '@effect/rpc/Rpc';
import * as RpcGroup from '@effect/rpc/RpcGroup';
import { Schema } from 'effect';

export const PublicConfig = Schema.Struct({
  googleMapsApiKey: Schema.NullOr(Schema.NonEmptyString),
  sentryDsn: Schema.NullOr(Schema.NonEmptyString),
});

export type PublicConfig = Schema.Schema.Type<typeof PublicConfig>;

export const ConfigPublic = Rpc.make('config.public', {
  payload: Schema.Void,
  success: PublicConfig,
});

export class AppRpcs extends RpcGroup.make(ConfigPublic) {}
